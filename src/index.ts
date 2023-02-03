import LRUCache from 'lru-cache'
import { posix, win32 } from 'path'

import { lstatSync, readdirSync, readlinkSync } from 'fs'
import { lstat, readdir, readlink } from 'fs/promises'

import { Dirent, Stats } from 'fs'

// turn something like //?/c:/ into c:\
const uncDriveRegexp = /^\\\\\?\\([a-z]:)\\?$/
const uncToDrive = (rootPath: string): string =>
  rootPath.replace(/\//g, '\\').replace(uncDriveRegexp, '$1:\\')

// if it's a drive letter path, return the drive letter plus \
// otherwise, return \
const driveCwd = (c: string): string =>
  (c.match(/^([a-z]):(?:\\|\/|$)/)?.[1] || '') + '\\'
const eitherSep = /[\\\/]/

const UNKNOWN = 0 // may not even exist, for all we know
const IFIFO = 0b0001
const IFCHR = 0b0010
const IFDIR = 0b0100
const IFBLK = 0b0110
const IFREG = 0b1000
const IFLNK = 0b1010
const IFSOCK = 0b1100
const IFMT = 0b1111

// mask to unset low 4 bits
const IFMT_UNKNOWN = ~IFMT
// set after successfully calling readdir() and getting entries.
const READDIR_CALLED = 0b0001_0000
// set if an entry (or one of its parents) is definitely not a dir
const ENOTDIR = 0b0010_0000
// set if an entry (or one of its parents) does not exist
// (can also be set on lstat errors like EACCES or ENAMETOOLONG)
const ENOENT = 0b0100_0000
// cannot have child entries -- also verify &IFMT is either IFDIR or IFLNK
const ENOCHILD = ENOTDIR | ENOENT
// set if we fail to readlink
const ENOREADLINK = 0b1000_0000
const TYPEMASK = 0b1111_1111

const entToType = (s: Dirent | Stats) =>
  s.isFile()
    ? IFREG
    : s.isDirectory()
    ? IFDIR
    : s.isSymbolicLink()
    ? IFLNK
    : s.isCharacterDevice()
    ? IFCHR
    : s.isBlockDevice()
    ? IFBLK
    : s.isSocket()
    ? IFSOCK
    : s.isFIFO()
    ? IFIFO
    : UNKNOWN

export interface PathOpts {
  fullpath?: string
  parent?: PathBase
}

class ResolveCache<T> extends LRUCache<string, T> {
  constructor() {
    super({ max: 256 })
  }
}

// In order to prevent blowing out the js heap by allocating hundreds of
// thousands of Path entries when walking extremely large trees, the "children"
// in this tree are represented by storing an array of Path entries in an
// LRUCache, indexed by the parent.  At any time, Path.children() may return an
// empty array, indicating that it doesn't know about any of its children, and
// thus has to rebuild that cache.  This is fine, it just means that we don't
// benefit as much from having the cached entries, but huge directory walks
// don't blow out the stack, and smaller ones are still as fast as possible.
//
//It does impose some complexity when building up the readdir data, because we
//need to pass a reference to the children array that we started with.

class ChildrenCache extends LRUCache<PathBase, Children> {
  constructor(maxSize: number = 16 * 1024) {
    super({
      maxSize,
      // parent + children
      sizeCalculation: a => a.length + 1,
    })
  }
}

type Children = PathBase[] & { provisional: number }

// Path objects are sort of like a super powered Dirent
export abstract class PathBase implements Dirent {
  name: string
  root: PathBase
  roots: { [k: string]: PathBase }
  parent?: PathBase
  nocase: boolean

  abstract splitSep: string | RegExp
  abstract sep: string

  #matchName: string
  #fullpath?: string
  #type: number
  #resolveCache: ResolveCache<PathBase>
  #children: ChildrenCache
  #linkTarget?: PathBase

  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean,
    children: ChildrenCache,
    opts: PathOpts
  ) {
    this.name = name

    this.#matchName = nocase ? name.toLowerCase() : name
    this.#type = type & TYPEMASK
    this.nocase = nocase
    this.roots = roots
    this.root = root || this
    this.#resolveCache = new ResolveCache()
    this.#children = children
    Object.assign(this, opts)
  }

  abstract getRootString(path: string): string
  abstract getRoot(rootPath: string): PathBase
  abstract newChild(name: string, type?: number, opts?: PathOpts): PathBase

  childrenCache() {
    return this.#children
  }

  // walk down to a single path, and return the final PathBase object created
  resolve(path?: string): PathBase {
    if (!path) {
      return this
    }
    const cached = this.#resolveCache.get(path)
    if (cached) {
      return cached
    }
    const rootPath = this.getRootString(path)
    const dir = path.substring(rootPath.length)
    const dirParts = dir.split(this.splitSep)
    const result: PathBase = rootPath
      ? this.getRoot(rootPath).#resolveParts(dirParts)
      : this.#resolveParts(dirParts)
    this.#resolveCache.set(path, result)
    return result
  }

  #resolveParts(dirParts: string[]) {
    let p: PathBase = this
    for (const part of dirParts) {
      p = p.child(part)
    }
    return p
  }

  children(): Children {
    const cached = this.#children.get(this)
    if (cached) {
      return cached
    }
    const children: Children = Object.assign([], { provisional: 0 })
    this.#children.set(this, children)
    this.#type &= ~READDIR_CALLED
    return children
  }

  child(pathPart: string): PathBase {
    if (pathPart === '' || pathPart === '.') {
      return this
    }
    if (pathPart === '..') {
      return this.parent || this
    }

    // find the child
    const children = this.children()
    const name = this.nocase ? pathPart.toLowerCase() : pathPart
    for (const p of children) {
      if (p.#matchName === name) {
        return p
      }
    }

    // didn't find it, create provisional child, since it might not
    // actually exist.  If we know the parent isn't a dir, then
    // in fact it CAN'T exist.
    const s = this.parent ? this.sep : ''
    const fullpath = this.#fullpath
      ? this.#fullpath + s + pathPart
      : undefined
    const pchild = this.newChild(pathPart, UNKNOWN)
    pchild.parent = this
    pchild.#fullpath = fullpath

    if (this.#cannotReaddir()) {
      pchild.#type |= ENOENT
    }

    // don't have to update provisional, because if we have real children,
    // then provisional is set to children.length, otherwise a lower number
    children.push(pchild)
    return pchild
  }

  fullpath(): string {
    if (this.#fullpath !== undefined) {
      return this.#fullpath
    }
    const name = this.name
    const p = this.parent
    if (!p) {
      return (this.#fullpath = this.name)
    }
    const pv = p.fullpath()
    const fp = pv + (!p.parent ? '' : this.sep) + name
    return (this.#fullpath = fp)
  }

  isUnknown(): boolean {
    return (this.#type && IFMT) === UNKNOWN
  }
  isFile(): boolean {
    return (this.#type & IFMT) === IFREG
  }
  // a directory, or a symlink to a directory
  isDirectory(): boolean {
    return (this.#type & IFMT) === IFDIR
  }
  isCharacterDevice(): boolean {
    return (this.#type & IFMT) === IFCHR
  }
  isBlockDevice(): boolean {
    return (this.#type & IFMT) === IFBLK
  }
  isFIFO(): boolean {
    return (this.#type & IFMT) === IFIFO
  }
  isSocket(): boolean {
    return (this.#type & IFMT) === IFSOCK
  }

  // we know it is a symlink
  isSymbolicLink(): boolean {
    return (this.#type & IFLNK) === IFLNK
  }

  #cannotReaddir() {
    if (this.#type & ENOCHILD) return true
    const ifmt = this.#type & IFMT
    // if we know it's not a dir or link, don't even try
    return !(ifmt === UNKNOWN || ifmt === IFDIR || ifmt === IFLNK)
  }

  async readlink(): Promise<PathBase | undefined> {
    const target = this.#linkTarget
    if (target) {
      return target
    }
    if (this.#cannotReadlink()) {
      return undefined
    }
    /* c8 ignore start */
    // already covered by the cannotReadlink test, here for ts grumples
    if (!this.parent) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = await readlink(this.fullpath())
      const linkTarget = this.parent.resolve(read)
      if (linkTarget) {
        return (this.#linkTarget = linkTarget)
      }
    } catch (er) {
      this.#readlinkFail(er as NodeJS.ErrnoException)
      return undefined
    }
  }

  readlinkSync(): PathBase | undefined {
    const target = this.#linkTarget
    if (target) {
      return target
    }
    if (this.#cannotReadlink()) {
      return undefined
    }
    /* c8 ignore start */
    // already covered by the cannotReadlink test, here for ts grumples
    if (!this.parent) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = readlinkSync(this.fullpath())
      const linkTarget = this.parent.resolve(read)
      if (linkTarget) {
        return (this.#linkTarget = linkTarget)
      }
    } catch (er) {
      this.#readlinkFail(er as NodeJS.ErrnoException)
      return undefined
    }
  }

  #cannotReadlink(): boolean {
    if (!this.parent) return false
    // cases where it cannot possibly succeed
    const ifmt = this.#type & IFMT
    return (
      !!(ifmt !== UNKNOWN && ifmt !== IFLNK) ||
      !!(this.#type & ENOREADLINK) ||
      !!(this.#type & ENOENT)
    )
  }

  #calledReaddir(): boolean {
    return (this.#type & READDIR_CALLED) === READDIR_CALLED
  }

  #readdirSuccess(children: Children) {
    // succeeded, mark readdir called bit
    this.#type |= READDIR_CALLED
    // mark all remaining provisional children as ENOENT
    for (let p = children.provisional; p < children.length; p++) {
      children[p].#markENOENT()
    }
  }

  #markENOENT() {
    // mark as UNKNOWN and ENOENT
    if (this.#type & ENOENT) return
    this.#type = (this.#type | ENOENT) & IFMT_UNKNOWN
    this.#markChildrenENOENT()
  }

  #markChildrenENOENT() {
    // all children are provisional and do not exist
    const children = this.children()
    children.provisional = 0
    for (const p of children) {
      p.#markENOENT()
    }
  }

  // save the information when we know the entry is not a dir
  #markENOTDIR() {
    // entry is not a directory, so any children can't exist.
    // if it's already marked ENOTDIR, bail
    if (this.#type & ENOTDIR) return
    let t = this.#type
    // this could happen if we stat a dir, then delete it,
    // then try to read it or one of its children.
    if ((t & IFMT) === IFDIR) t &= IFMT_UNKNOWN
    this.#type = t | ENOTDIR
    this.#markChildrenENOENT()
  }

  #readdirFail(er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR' || er.code === 'EPERM') {
      this.#markENOTDIR()
    }
    if (er.code === 'ENOENT') {
      this.#markENOENT()
    } else {
      this.children().provisional = 0
    }
  }

  #lstatFail(er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR') {
      const e = this.parent || this
      e.#markENOTDIR()
    } else if (er.code === 'ENOENT') {
      this.#markENOENT()
    }
  }

  #readlinkFail(er: NodeJS.ErrnoException) {
    let ter = this.#type
    ter |= ENOREADLINK
    if (er.code === 'ENOENT') ter |= ENOENT
    if (er.code === 'EINVAL') {
      // exists, but not a symlink, we don't know WHAT it is, so remove
      // all IFMT bits.
      ter &= IFMT_UNKNOWN
    }
    this.#type = ter
    if (er.code === 'ENOTDIR' && this.parent) {
      this.parent.#markENOTDIR()
    }
  }

  #readdirAddChild(e: Dirent, c: Children) {
    return (
      this.#readdirMaybePromoteChild(e, c) ||
      this.#readdirAddNewChild(e, c)
    )
  }

  // TODO: mark private once readdir factors over
  #readdirAddNewChild(e: Dirent, c: Children): PathBase {
    // alloc new entry at head, so it's never provisional
    const type = entToType(e)
    const child = this.newChild(e.name, type, { parent: this })
    c.unshift(child)
    c.provisional++
    return child
  }

  // TODO: mark private once readdir factors over
  #readdirMaybePromoteChild(e: Dirent, c: Children): PathBase | undefined {
    for (let p = c.provisional; p < c.length; p++) {
      const pchild = c[p]
      const name = this.nocase ? e.name.toLowerCase() : e.name
      if (name !== pchild.#matchName) {
        continue
      }

      return this.#readdirPromoteChild(e, pchild, p, c)
    }
  }

  // TODO: make private once all of readdir factors over
  #readdirPromoteChild(
    e: Dirent,
    p: PathBase,
    index: number,
    c: Children
  ): PathBase {
    const v = p.name
    p.#type = entToType(e)
    // case sensitivity fixing when we learn the true name.
    if (v !== e.name) p.name = e.name

    // just advance provisional index (potentially off the list),
    // otherwise we have to splice/pop it out and re-insert at head
    if (index !== c.provisional) {
      if (index === c.length - 1) c.pop()
      else c.splice(index, 1)
      c.unshift(p)
    }
    c.provisional++
    return p
  }

  async lstat(): Promise<PathBase | undefined> {
    if ((this.#type & ENOENT) === 0) {
      try {
        // retain any other flags, but set the ifmt
        this.#type =
          (this.#type & IFMT_UNKNOWN) |
          entToType(await lstat(this.fullpath()))
        return this
      } catch (er) {
        this.#lstatFail(er as NodeJS.ErrnoException)
      }
    }
  }

  lstatSync(): PathBase | undefined {
    if ((this.#type & ENOENT) === 0) {
      try {
        // retain any other flags, but set the ifmt
        this.#type =
          (this.#type & IFMT_UNKNOWN) |
          entToType(lstatSync(this.fullpath()))
        return this
      } catch (er) {
        this.#lstatFail(er as NodeJS.ErrnoException)
      }
    }
  }

  readdirSync(): PathBase[] {
    if (this.#cannotReaddir()) {
      return []
    }

    const children = this.children()
    if (this.#calledReaddir()) {
      return children.slice(0, children.provisional)
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = this.fullpath()
    try {
      for (const e of readdirSync(fullpath, { withFileTypes: true })) {
        this.#readdirAddChild(e, children)
      }
      this.#readdirSuccess(children)
    } catch (er) {
      this.#readdirFail(er as NodeJS.ErrnoException)
      children.provisional = 0
    }
    return children.slice(0, children.provisional)
  }

  async readdir(): Promise<PathBase[]> {
    if (this.#cannotReaddir()) {
      return []
    }

    const children = this.children()
    if (this.#calledReaddir()) {
      return children.slice(0, children.provisional)
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = this.fullpath()
    try {
      for (const e of await readdir(fullpath, { withFileTypes: true })) {
        this.#readdirAddChild(e, children)
      }
      this.#readdirSuccess(children)
    } catch (er) {
      this.#readdirFail(er as NodeJS.ErrnoException)
      children.provisional = 0
    }
    return children.slice(0, children.provisional)
  }
}

export class PathWin32 extends PathBase {
  sep: '\\' = '\\'
  splitSep: RegExp = eitherSep

  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean = true,
    children: ChildrenCache,
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, children, opts)
  }

  newChild(name: string, type: number = UNKNOWN, opts: PathOpts = {}) {
    return new PathWin32(
      name,
      type,
      this.root,
      this.roots,
      this.nocase,
      this.childrenCache(),
      opts
    )
  }

  getRootString(path: string): string {
    return win32.parse(path).root
  }

  getRoot(rootPath: string): PathBase {
    if (rootPath === this.root.name) {
      return this.root
    }
    if (this.sameRoot(rootPath)) {
      return (this.roots[rootPath] = this.root)
    }
    return (this.roots[rootPath] = new PathWalkerWin32(
      rootPath,
      this
    ).root)
  }

  sameRoot(rootPath: string): boolean {
    rootPath = rootPath
      .replace(/\\/g, '\\')
      .replace(/\\\\\?\\([a-z]:)\\?$/, '$1:\\')
    // windows can (rarely) have case-sensitive filesystem, but
    // UNC and drive letters are always case-insensitive
    if (rootPath.toUpperCase() === this.root.name.toUpperCase()) {
      return true
    }
    return false
  }
}

export class PathPosix extends PathBase {
  splitSep: '/' = '/'
  sep: '/' = '/'

  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean = false,
    children: ChildrenCache,
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, children, opts)
  }

  getRootString(path: string): string {
    return path.startsWith('/') ? '/' : ''
  }

  getRoot(_rootPath: string): PathBase {
    return this.root
  }

  newChild(name: string, type: number = UNKNOWN, opts: PathOpts = {}) {
    return new PathPosix(
      name,
      type,
      this.root,
      this.roots,
      this.nocase,
      this.childrenCache(),
      opts
    )
  }
}

export interface PathWalkerOpts {
  nocase?: boolean
  roots?: { [k: string]: PathBase }
  childrenCacheSize?: number
}

export abstract class PathWalkerBase {
  root: PathBase
  rootPath: string
  roots: { [k: string]: PathBase }
  cwd: PathBase
  cwdPath: string
  #resolveCache: ResolveCache<string>
  #children: ChildrenCache
  abstract nocase: boolean
  abstract sep: string | RegExp

  constructor(
    cwd: string = process.cwd(),
    pathImpl: typeof win32 | typeof posix,
    sep: string | RegExp,
    {
      roots = Object.create(null),
      childrenCacheSize = 16 * 1024,
    }: PathWalkerOpts = {}
  ) {
    // resolve and split root, and then add to the store.
    // this is the only time we call path.resolve()
    const cwdPath = pathImpl.resolve(cwd)
    this.cwdPath = cwdPath
    this.rootPath = this.parseRootPath(cwdPath)
    this.#resolveCache = new ResolveCache()
    this.#children = new ChildrenCache(childrenCacheSize)

    const split = cwdPath.substring(this.rootPath.length).split(sep)
    // resolve('/') leaves '', splits to [''], we don't want that.
    if (split.length === 1 && !split[0]) {
      split.pop()
    }
    // we can safely assume the root is a directory.
    this.roots = roots
    const existing = this.roots[this.rootPath]
    if (existing) {
      this.root = existing
    } else {
      this.root = this.newRoot()
      this.roots[this.rootPath] = this.root
    }
    let prev: PathBase = this.root
    for (const part of split) {
      prev = prev.child(part)
    }
    this.cwd = prev
  }

  abstract parseRootPath(dir: string): string
  abstract newRoot(): PathBase
  abstract isAbsolute(p: string): boolean

  // needed so subclasses can create Path objects
  childrenCache() {
    return this.#children
  }

  // same interface as require('path').resolve
  resolve(...paths: string[]): string {
    // first figure out the minimum number of paths we have to test
    // we always start at cwd, but any absolutes will bump the start
    let r = ''
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i]
      if (!p || p === '.') continue
      r = r ? `${p}/${r}` : p
      if (this.isAbsolute(p)) {
        break
      }
    }
    const cached = this.#resolveCache.get(r)
    if (cached !== undefined) {
      return cached
    }
    const result = this.cwd.resolve(r).fullpath()
    this.#resolveCache.set(r, result)
    return result
  }

  // dirname/name/fullpath always within a given PW, so we know
  // that the only thing that can be parentless is the root, unless
  // something is deeply wrong.
  basename(entry: PathBase | string = this.cwd): string {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.name
  }

  dirname(entry: PathBase | string = this.cwd): string {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return (entry.parent || entry).fullpath()
  }

  readdir(
    entry?: PathBase | string,
    options?: { withFileTypes: true }
  ): Promise<PathBase[]>
  readdir(
    entry: PathBase | string,
    options: { withFileTypes: false }
  ): Promise<string[]>
  readdir(
    entry: PathBase | string,
    options: { withFileTypes: boolean }
  ): Promise<string[] | PathBase[]>
  async readdir(
    entry: PathBase | string = this.cwd,
    { withFileTypes = true }: { withFileTypes: boolean } = {
      withFileTypes: true,
    }
  ): Promise<PathBase[] | string[]> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    if (withFileTypes) {
      return entry.readdir()
    } else {
      return (await entry.readdir()).map(e => e.name)
    }
  }

  /**
   * A generator that iterates over the directory entries.
   * Similar to fs.readdirSync, but:
   * - Iterator rather than an array
   * - On directory read failures, simply does not yield any entries,
   *   rather than erroring.
   * - `{withFileTypes}` option defaults to true, rather than false.
   *   Ie, to get strings, pass `{withFileTypes: false}`
   * - Results are cached.
   */
  readdirSync(
    entry?: PathBase | string,
    options?: { withFileTypes: true }
  ): PathBase[]
  readdirSync(
    entry: PathBase | string,
    options: { withFileTypes: false }
  ): string[]
  readdirSync(
    entry: PathBase | string,
    options: { withFileTypes: boolean }
  ): string[] | PathBase[]
  readdirSync(
    entry: PathBase | string = this.cwd,
    { withFileTypes = true }: { withFileTypes: boolean } = {
      withFileTypes: true,
    }
  ): PathBase[] | string[] {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    if (withFileTypes) {
      return entry.readdirSync()
    } else {
      return entry.readdirSync().map(e => e.name)
    }
  }

  // take either a string or Path, move implementation details to Path
  // fills in the data we can gather, or returns undefined on error
  // effectively always {withFileTypes:true}, because that's the point
  async lstat(
    entry: string | PathBase = this.cwd
  ): Promise<PathBase | undefined> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.lstat()
  }

  lstatSync(entry: string | PathBase = this.cwd): PathBase | undefined {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.lstatSync()
  }

  readlink(
    entry: string | PathBase,
    opt?: { withFileTypes: false }
  ): Promise<string | undefined>
  readlink(
    entry: string | PathBase,
    opt: { withFileTypes: true }
  ): Promise<PathBase | undefined>
  readlink(
    entry: string | PathBase,
    opt: { withFileTypes: boolean }
  ): Promise<string | PathBase | undefined>
  async readlink(
    entry: string | PathBase,
    { withFileTypes }: { withFileTypes: boolean } = {
      withFileTypes: false,
    }
  ): Promise<string | PathBase | undefined> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const e = await entry.readlink()
    return withFileTypes ? e : e?.fullpath()
  }

  readlinkSync(
    entry: string | PathBase,
    opt?: { withFileTypes: false }
  ): string | undefined
  readlinkSync(
    entry: string | PathBase,
    opt: { withFileTypes: true }
  ): PathBase | undefined
  readlinkSync(
    entry: string | PathBase,
    opt: { withFileTypes: boolean }
  ): string | PathBase | undefined
  readlinkSync(
    entry: string | PathBase,
    { withFileTypes }: { withFileTypes: boolean } = {
      withFileTypes: false,
    }
  ): string | PathBase | undefined {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const e = entry.readlinkSync()
    return withFileTypes ? e : e?.fullpath()
  }
}

// windows paths, default nocase=true
export class PathWalkerWin32 extends PathWalkerBase {
  // defaults to case-insensitive
  nocase: boolean = true
  sep: '\\' = '\\'

  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    super(cwd, win32, '\\', opts)
    const { nocase = this.nocase } = opts
    this.nocase = nocase
  }

  parseRootPath(dir: string): string {
    // if the path starts with a single separator, it's not a UNC, and we'll
    // just get separator as the root, and driveFromUNC will return \
    // In that case, mount \ on the root from the cwd.
    const rootPath = win32.parse(dir).root
    const driveFromUNC = uncToDrive(rootPath)
    if (driveFromUNC === this.sep) {
      return driveCwd(win32.resolve(driveFromUNC)) + this.sep
    } else {
      return driveFromUNC
    }
  }

  newRoot() {
    return new PathWin32(
      this.rootPath,
      IFDIR,
      undefined,
      this.roots,
      this.nocase,
      this.childrenCache(),
      {}
    )
  }

  isAbsolute(p: string): boolean {
    return (
      p.startsWith('/') || p.startsWith('\\') || /^[a-z]:(\/|\\)/i.test(p)
    )
  }
}

// posix paths, default nocase=false
export class PathWalkerPosix extends PathWalkerBase {
  nocase: boolean = false
  sep: '/' = '/'
  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    super(cwd, posix, '/', opts)
    const { nocase = this.nocase } = opts
    this.nocase = nocase
  }

  parseRootPath(_dir: string): string {
    return '/'
  }

  newRoot() {
    return new PathPosix(
      this.rootPath,
      IFDIR,
      undefined,
      this.roots,
      this.nocase,
      this.childrenCache(),
      {}
    )
  }

  isAbsolute(p: string): boolean {
    return p.startsWith('/')
  }
}

// posix paths, default nocase=true
export class PathWalkerDarwin extends PathWalkerPosix {
  nocase: boolean = true
}

// default forms for the current platform
export const Path: typeof PathBase =
  process.platform === 'win32' ? PathWin32 : PathPosix
export type Path = PathBase

export const PathWalker:
  | typeof PathWalkerWin32
  | typeof PathWalkerDarwin
  | typeof PathWalkerPosix =
  process.platform === 'win32'
    ? PathWalkerWin32
    : process.platform === 'darwin'
    ? PathWalkerDarwin
    : PathWalkerPosix
export type PathWalker = PathWalkerBase
