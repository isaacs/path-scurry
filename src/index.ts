// TODO: move most/all of this logic over to the Path class.
// The PathWalker should operate on *strings*, and the Paths should
// operate on *Paths*, should be a good blend of performance and
// usability.
//
// so PathWalker.dirname(str) returns
// PathWalker.cwd().resolve(dir).dirname().fullpath()

import LRUCache from 'lru-cache'
import { posix, win32 } from 'path'

import { Dir, lstatSync, opendirSync, readlinkSync } from 'fs'
import { lstat, readdir, readlink } from 'fs/promises'

import { Dirent, Stats } from 'fs'

function* syncDirIterate(dir: Dir) {
  let e
  try {
    while ((e = dir.readSync())) {
      yield e
    }
  } finally {
    dir.closeSync()
  }
}

// turn something like //?/c:/ into c:\
const uncDriveRegexp = /^\\\\\?\\([a-z]:)\\?$/
const uncToDrive = (rootPath: string): string =>
  rootPath.replace(/\//g, '\\').replace(uncDriveRegexp, '$1:\\')

// if it's a drive letter path, return the drive letter plus \
// otherwise, return \
const driveCwd = (c: string): string =>
  (c.match(/^([a-z]):(?:\\|\/|$)/)?.[1] || '') + '\\'
const eitherSep = /[\\\/]/

// a PathWalker has a PointerSet with the following setup:
// - value: the string representing the path portion, using
//   `/` for posix root paths.
// - type: a raw uint32 field:
//    - low 4 bits are the S_IFMT nibble, or 0 for "unknown"
//    - remaining bits are used for various helpful flags.
// - parent: pointer to parent directory
// - children: array of provisional and known child entries
// - provisional: index in the array of the first provisional child
//   0 until a successful readdir with entries.
// - linkTarget: pointer to path entry that symlink references, if known
//
// Each PathWalker has a single root, but they can share the same store,
// so you could potentially have multiple entries in the store that are
// parentless, even though each PathWalker only has a single root entry.

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
// cannot have child entries
const ENOCHILD = ENOTDIR | ENOENT | IFREG
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

// TODO
// Non-PointerSet approach:
// each "Path" is:
// {
//   name: string (no separators, just a single portion)
//   fullpath?: string (cached resolve())
//   type: number (uint32 of flags)
//   parent?: Path
//   children: Path[]
//   provisional: number
//   linkTarget?: Path
// }
//
// The PathWalker has a reference to the roots it's seen (which there will only
// be one of on Posix systems, but on Windows could be any number), and all the
// methods for operating on Path objects.
//
// The operations are essentially the same, but instead of taking a Pointer,
// they receive a Path object, and instead of doing stuff like:
// `this.store.ref(pointer, field, otherPointer)` it just does:
// `path[field] = otherPath`.
//
// So we still do each operation exactly once, and a given resolved path string
// always points to the same Path object. And hopefully, the GC won't be so
// terrible, because the entire graph can be pruned at once.
//
// A next step, if gc IS an issue, is to try storing all the Path objects in an
// array, and replacing the Path references to numeric indexes into that array.
// Then each Path would only ever be referenced by the array, and as long as
// none of them make it to old object generation, we should be good there.

interface PathOpts {
  fullpath?: string
  parent?: PathBase
  children?: PathBase[]
  provisional?: number
  linkTarget?: PathBase
}

class ResolveCache extends LRUCache<string, PathBase> {
  constructor() {
    super({ max: 256 })
  }
}

// Path objects are sort of like a super powered Dirent
export abstract class PathBase implements Dirent {
  name: string
  matchName: string
  #fullpath?: string
  #type: number
  nocase: boolean
  abstract splitSep: string | RegExp
  abstract sep: string

  cache: ResolveCache
  root: PathBase
  roots: { [k: string]: PathBase }
  parent?: PathBase
  // TODO: test replacing linked list with Path[], indexes with numbers
  children: PathBase[] = []
  provisional: number = 0
  linkTarget?: PathBase

  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean,
    opts: PathOpts
  ) {
    this.name = name

    this.matchName = nocase ? name.toLowerCase() : name
    this.#type = type & TYPEMASK
    this.nocase = nocase
    this.roots = roots
    this.root = root || this
    this.cache = new ResolveCache()
    Object.assign(this, opts)
  }

  abstract getRootString(path: string): string
  abstract getRoot(rootPath: string): PathBase

  // walk down to a single path, and return the final PathBase object created
  resolve(path?: string): PathBase {
    if (!path) {
      return this
    }
    const cached = this.cache.get(path)
    if (cached) {
      return cached
    }
    const rootPath = this.getRootString(path)
    const dir = path.substring(rootPath.length)
    const dirParts = dir.split(this.splitSep)
    const result: PathBase = rootPath
      ? this.getRoot(rootPath).resolveParts(dirParts)
      : this.resolveParts(dirParts)
    this.cache.set(path, result)
    return result
  }

  resolveParts(dirParts: string[]) {
    let p: PathBase = this
    for (const part of dirParts) {
      p = p.child(part)
    }
    return p
  }

  abstract newChild(name: string, type?: number, opts?: PathOpts): PathBase

  child(pathPart: string): PathBase {
    if (pathPart === '' || pathPart === '.') {
      return this
    }
    if (pathPart === '..') {
      return this.parent || this
    }

    // find the child
    const { children } = this
    const name = this.nocase ? pathPart.toLowerCase() : pathPart
    for (const p of children) {
      if (p.matchName === name) {
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

    if (this.getType() & ENOCHILD) {
      pchild.setType(ENOENT)
    }

    // have children, just not provisional children
    // or first child, of any kind, is provisional
    if (this.provisional < children.length) {
      this.provisional = children.length
    }
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

  getType(): number {
    return this.#type
  }
  setType(type: number): number {
    return (this.#type = type & TYPEMASK)
  }
  addType(type: number): number {
    return (this.#type |= type & TYPEMASK)
  }

  isUnknown(): boolean {
    return (this.getType() && IFMT) === UNKNOWN
  }
  isFile(): boolean {
    return (this.getType() & IFMT) === IFREG
  }
  // a directory, or a symlink to a directory
  isDirectory(): boolean {
    return (this.getType() & IFMT) === IFDIR
  }
  isCharacterDevice(): boolean {
    return (this.getType() & IFMT) === IFCHR
  }
  isBlockDevice(): boolean {
    return (this.getType() & IFMT) === IFBLK
  }
  isFIFO(): boolean {
    return (this.getType() & IFMT) === IFIFO
  }
  isSocket(): boolean {
    return (this.getType() & IFMT) === IFSOCK
  }

  // we know it is a symlink
  isSymbolicLink(): boolean {
    return (this.getType() & IFLNK) === IFLNK
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
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, opts)
  }

  newChild(name: string, type: number = UNKNOWN, opts: PathOpts = {}) {
    return new PathWin32(
      name,
      type,
      this.root,
      this.roots,
      this.nocase,
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
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, opts)
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
      opts
    )
  }
}

export interface PathWalkerOpts {
  nocase?: boolean
  roots?: { [k: string]: PathBase }
  cache?: LRUCache<string, PathBase>
  platform?: string
}

abstract class PathWalkerBase {
  root: PathBase
  rootPath: string
  roots: { [k: string]: PathBase }
  cwd: PathBase
  cwdPath: string
  abstract nocase: boolean
  abstract sep: string | RegExp

  constructor(
    cwd: string = process.cwd(),
    pathImpl: typeof win32 | typeof posix,
    sep: string | RegExp,
    { roots = Object.create(null) }: PathWalkerOpts = {}
  ) {
    // resolve and split root, and then add to the store.
    // this is the only time we call path.resolve()
    const cwdPath = pathImpl.resolve(cwd)
    this.cwdPath = cwdPath
    this.rootPath = this.parseRootPath(cwdPath)

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

  // same interface as require('path').resolve
  resolve(...paths: string[]): string {
    // first figure out the minimum number of paths we have to test
    // we always start at cwd, but any absolutes will bump the start
    let r = ''
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i]
      if (!p || p === '.') continue
      r = `${r}/${p}`
      if (this.isAbsolute(p)) {
        break
      }
    }
    return this.cwd.resolve(r).fullpath()
  }

  abstract isAbsolute(p: string): boolean

  // dirname/name/fullpath always within a given PW, so we know
  // that the only thing that can be parentless is the root, unless
  // something is deeply wrong.
  basename(entry: PathBase | string = this.cwd): string {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.name
  }

  // move to Path
  dirname(entry: PathBase = this.cwd): string {
    return !entry.parent
      ? entry.name
      : entry.parent.fullpath()
  }

  // move to Path
  calledReaddir(p: PathBase): boolean {
    return (p.getType() & READDIR_CALLED) === READDIR_CALLED
  }

  // move to Path
  cachedReaddir(entry: PathBase, withFileTypes: false): string[]
  cachedReaddir(entry: PathBase, withFileTypes: true): PathBase[]
  cachedReaddir(
    entry: PathBase,
    withFileTypes: boolean
  ): string[] | PathBase[]
  cachedReaddir(
    entry: PathBase,
    withFileTypes: boolean
  ): string[] | PathBase[] {
    const { children, provisional } = entry
    const c = children.slice(0, provisional)
    return withFileTypes ? c : c.map(c => c.name)
  }

  // move withFileTypes impl to Path, call that and stringify if not
  // asynchronous iterator for dir entries
  // not a "for await" async iterator, but an async function
  // that returns an iterable array.
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
    const t = entry.getType()
    if ((t & ENOCHILD) !== 0) {
      return []
    }

    if (this.calledReaddir(entry)) {
      return this.cachedReaddir(entry, withFileTypes)
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = entry.fullpath()
    try {
      // iterators are cool, and this does have the shortcoming
      // of falling over on dirs with *massive* amounts of entries,
      // but async iterators are just too slow by comparison.
      for (const e of await readdir(fullpath, { withFileTypes: true })) {
        this.readdirAddChild(entry, e)
      }
    } catch (er) {
      this.readdirFail(entry, er as NodeJS.ErrnoException)
      // all refs must be considered provisional, since it did not
      // complete.  but if we haven't gotten any children, then it's
      // still -1.
      entry.provisional = entry.children.length ? 0 : -1
      return []
    }

    this.readdirSuccess(entry)
    return this.cachedReaddir(entry, withFileTypes)
  }

  // move to Path
  readdirSuccess(entry: PathBase) {
    // succeeded, mark readdir called bit
    entry.addType(READDIR_CALLED)
    // mark all remaining provisional children as ENOENT
    const { children, provisional } = entry
    for (let p = provisional; p < children.length; p++) {
      this.markENOENT(children[p])
    }
  }

  // move to Path
  readdirAddChild(entry: PathBase, e: Dirent) {
    return (
      this.readdirMaybePromoteChild(entry, e) ||
      this.readdirAddNewChild(entry, e)
    )
  }

  // move to Path
  readdirMaybePromoteChild(
    entry: PathBase,
    e: Dirent
  ): PathBase | undefined {
    const { children, provisional } = entry
    for (let p = provisional; p < children.length; p++) {
      const pchild = children[p]
      const name = this.nocase ? e.name.toLowerCase() : e.name
      if (name !== pchild.matchName) {
        continue
      }

      return this.readdirPromoteChild(entry, e, pchild, p)
    }
  }

  // move to Path
  readdirPromoteChild(
    entry: PathBase,
    e: Dirent,
    p: PathBase,
    index: number
  ): PathBase {
    const { children, provisional } = entry
    const v = p.name
    const type = entToType(e)

    p.setType(type)
    // case sensitivity fixing when we learn the true name.
    if (v !== e.name) p.name = e.name

    // just advance provisional index (potentially off the list),
    // otherwise we have to splice/pop it out and re-insert at head
    if (index !== provisional) {
      if (index === children.length - 1) entry.children.pop()
      else entry.children.splice(index, 1)
      entry.children.unshift(p)
    }
    entry.provisional++
    return p
  }

  // move to Path
  readdirAddNewChild(parent: PathBase, e: Dirent): PathBase {
    // alloc new entry at head, so it's never provisional
    const { children } = parent
    const type = entToType(e)
    const child = parent.newChild(e.name, type, { parent })
    children.unshift(child)
    parent.provisional++
    return child
  }

  // move to Path
  readdirFail(entry: PathBase, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR' || er.code === 'EPERM') {
      this.markENOTDIR(entry)
    }
    if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

  // move to Path
  // save the information when we know the entry is not a dir
  markENOTDIR(entry: PathBase) {
    // entry is not a directory, so any children can't exist.
    // unmark IFDIR, mark ENOTDIR
    let t = entry.getType()
    // if it's already marked ENOTDIR, bail
    if (t & ENOTDIR) return
    // this could happen if we stat a dir, then delete it,
    // then try to read it or one of its children.
    if ((t & IFDIR) === IFDIR) t &= IFMT_UNKNOWN
    entry.setType(t | ENOTDIR)
    this.markChildrenENOENT(entry)
  }

  // move to Path
  markENOENT(entry: PathBase) {
    // mark as UNKNOWN and ENOENT
    const t = entry.getType()
    if (t & ENOENT) return
    entry.setType((t | ENOENT) & IFMT_UNKNOWN)
    this.markChildrenENOENT(entry)
  }

  // move to Path
  markChildrenENOENT(entry: PathBase) {
    // all children are provisional
    entry.provisional = 0

    // all children do not exist
    for (const p of entry.children) {
      this.markENOENT(p)
    }
  }

  // move to Path
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
  ): Generator<PathBase, void, void>
  readdirSync(
    entry: PathBase | string,
    options: { withFileTypes: false }
  ): Generator<string, void, void>
  readdirSync(
    entry: PathBase | string,
    options: { withFileTypes: boolean }
  ): Generator<string | PathBase, void, void>
  *readdirSync(
    entry: PathBase | string = this.cwd,
    { withFileTypes = true }: { withFileTypes: boolean } = {
      withFileTypes: true,
    }
  ): Generator<PathBase | string, void, void> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const t = entry.getType()
    if ((t & ENOCHILD) !== 0) {
      return
    }

    if (this.calledReaddir(entry)) {
      for (const e of this.cachedReaddir(entry, withFileTypes)) yield e
      return
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = entry.fullpath()
    let finished = false
    try {
      const dir = opendirSync(fullpath)
      for (const e of syncDirIterate(dir)) {
        const p = this.readdirAddChild(entry, e)
        yield withFileTypes ? p : p.name
      }
      finished = true
    } catch (er) {
      this.readdirFail(entry, er as NodeJS.ErrnoException)
    } finally {
      if (finished) {
        this.readdirSuccess(entry)
      } else {
        // all refs must be considered provisional now, since it failed.
        entry.provisional = 0
      }
    }
  }

  // take either a string or Path, move implementation details to Path
  // fills in the data we can gather, or returns undefined on error
  async lstat(entry: PathBase = this.cwd): Promise<PathBase | undefined> {
    const t = entry.getType()
    if (t & ENOENT) {
      return
    }
    try {
      entry.setType(entToType(await lstat(entry.fullpath())))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  // take either a string or Path
  lstatSync(entry: PathBase = this.cwd): PathBase | undefined {
    const t = entry.getType()
    if (t & ENOENT) {
      return
    }
    try {
      entry.setType(entToType(lstatSync(entry.fullpath())))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  // move to Path
  lstatFail(entry: PathBase, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR') {
      this.markENOTDIR(entry.parent || entry)
    } else if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

  // move to Path
  cannotReadlink(entry: PathBase): boolean {
    if (!entry.parent) return false
    const t = entry.getType()
    // cases where it cannot possibly succeed
    return (
      !!((t & IFMT) !== UNKNOWN && !(t & IFLNK)) ||
      !!(t & ENOREADLINK) ||
      !!(t & ENOENT)
    )
  }

  // take string or Path, move impl details to Path
  // take {withFileTypes:boolean} arg, return string if false, else PathBase
  async readlink(entry: PathBase): Promise<PathBase | undefined> {
    const target = entry.linkTarget
    if (target) {
      return target
    }
    if (this.cannotReadlink(entry)) {
      return undefined
    }
    const p = entry.parent
    /* c8 ignore start */
    // already covered by the cannotReadlink test, here for ts grumples
    if (!p) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = await readlink(entry.fullpath())
      const linkTarget = p.resolve(read)
      if (linkTarget) {
        return (entry.linkTarget = linkTarget)
      }
    } catch (er) {
      this.readlinkFail(entry, er as NodeJS.ErrnoException)
      return undefined
    }
  }

  // move to Path
  readlinkFail(entry: PathBase, er: NodeJS.ErrnoException) {
    let ter: number = ENOREADLINK | (er.code === 'ENOENT' ? ENOENT : 0)
    if (er.code === 'EINVAL') {
      // exists, but not a symlink, we don't know WHAT it is, so remove
      // all IFMT bits.
      ter &= IFMT_UNKNOWN
    }
    if (er.code === 'ENOTDIR' && entry.parent) {
      this.markENOTDIR(entry.parent)
    }
    entry.addType(ter)
  }

  // take string or Path, move impl details to Path
  // take {withFileTypes:boolean} arg, return string if false
  readlinkSync(entry: PathBase): PathBase | undefined {
    const target = entry.linkTarget
    if (target) {
      return target
    }
    if (this.cannotReadlink(entry)) {
      return undefined
    }
    const p = entry.parent
    /* c8 ignore start */
    // already covered by the cannotReadlink test, here for ts grumples
    if (!p) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = readlinkSync(entry.fullpath())
      const linkTarget = p.resolve(read)
      if (linkTarget) {
        return (entry.linkTarget = linkTarget)
      }
    } catch (er) {
      this.readlinkFail(entry, er as NodeJS.ErrnoException)
      return undefined
    }
  }
}

// TODO: factor out all the windows specific stuff and put it into
// PathWalkerWin32.  Then make PathWalker into abstract PathWalkerBase, and
// export the process.platform version as PathWalker, and don't take a
// 'platform' argument at all.

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
  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    super(cwd, { ...opts, platform: 'darwin' })
  }
}

// default forms for the current platform
export const Path: typeof PathWin32 | typeof PathPosix =
  process.platform === 'win32' ? PathWin32 : PathPosix

export const PathWalker:
  | typeof PathWalkerWin32
  | typeof PathWalkerDarwin
  | typeof PathWalkerPosix =
  process.platform === 'win32'
    ? PathWalkerWin32
    : process.platform === 'darwin'
    ? PathWalkerDarwin
    : PathWalkerPosix
