// TODO: move most/all of this logic over to the Path class.
// The PathWalker should operate on *strings*, and the Paths should
// operate on *Paths*, should be a good blend of performance and
// usability.
// so PathWalker.dirname(str) => PathWalker.resolve(dir).dirname().fullpath
//
// TODO: pw.resolve() should ONLY take strings, throw away any relatives
// that come before any absolutes, and cache the lookup
//
// TODO: instead of a linked list of children, put all Path objects into
// an array that the PathWalker has, and give them a number 'key' value.
// then, instead of a linked list of Path entries, each Path object
// has a 'children' array, and a 'phead' index to indicate which child
// indexes are provisional.

import LRUCache from 'lru-cache'
import { posix, sep, win32 } from 'path'

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
  (c.match(/^([a-z]):(?:\\|\/|$)/)?.[1] || '') + sep
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
//   basename: string (no separators, just a single portion)
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

export abstract class PathBase implements PathOpts {
  basename: string
  matchName: string
  fullpath?: string
  type: number
  nocase: boolean
  abstract splitSep: string | RegExp

  cache: ResolveCache
  root: PathBase
  roots: { [k: string]: PathBase }
  parent?: PathBase
  // TODO: test replacing linked list with Path[], indexes with numbers
  children: PathBase[] = []
  provisional: number = 0
  linkTarget?: PathBase

  constructor(
    basename: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean,
    opts: PathOpts
  ) {
    this.basename = basename

    this.matchName = nocase ? basename.toLowerCase() : basename
    this.type = type & TYPEMASK
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
    let result: PathBase
    if (rootPath) {
      result = this.getRoot(rootPath).resolveParts(dirParts)
    } else {
      result = this.resolveParts(dirParts)
    }
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
      const v = p.matchName
      if (v === name) {
        return p
      }
    }

    // didn't find it, create provisional child, since it might not
    // actually exist.  If we know the parent isn't a dir, then
    // in fact it CAN'T exist.
    const s = this.parent ? sep : ''
    const fullpath = this.fullpath
      ? this.fullpath + s + pathPart
      : undefined
    const pchild = this.newChild(pathPart, UNKNOWN, {
      parent: this,
      fullpath,
    })
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

  getType(): number {
    return this.type
  }
  setType(type: number): number {
    return (this.type = type & TYPEMASK)
  }
  addType(type: number): number {
    return (this.type |= type & TYPEMASK)
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
  splitSep: RegExp = eitherSep
  constructor(
    basename: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean = true,
    opts: PathOpts
  ) {
    super(basename, type, root, roots, nocase, opts)
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
    if (rootPath === this.root.basename) {
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
    if (rootPath.toUpperCase() === this.root.basename.toUpperCase()) {
      return true
    }
    return false
  }
}

export class PathPosix extends PathBase {
  splitSep: string = sep

  constructor(
    basename: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean = false,
    opts: PathOpts
  ) {
    super(basename, type, root, roots, nocase, opts)
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

export const Path: typeof PathWin32 | typeof PathPosix =
  process.platform === 'win32' ? PathWin32 : PathPosix

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

  constructor(
    cwd: string = process.cwd(),
    pathImpl: typeof win32 | typeof posix,
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

  // same as require('path').resolve
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
    return this.fullpath(this.cwd.resolve(r))
  }

  abstract isAbsolute(p: string): boolean

  parent(entry: PathBase): PathBase {
    // parentless entries are root path entries.
    return entry.parent || entry
  }

  // dirname/basename/fullpath always within a given PW, so we know
  // that the only thing that can be parentless is the root, unless
  // something is deeply wrong.
  basename(entry: PathBase = this.cwd): string {
    return entry.basename
  }

  fullpath(entry: PathBase = this.cwd): string {
    if (entry.fullpath) {
      return entry.fullpath
    }
    const basename = this.basename(entry)
    const p = entry.parent
    if (!p) {
      return (entry.fullpath = entry.basename)
    }
    const pv = this.fullpath(p)
    const fp = pv + (!p.parent ? '' : '/') + basename
    return (entry.fullpath = fp)
  }

  dirname(entry: PathBase = this.cwd): string {
    return !entry.parent
      ? this.basename(entry)
      : this.fullpath(entry.parent)
  }

  calledReaddir(p: PathBase): boolean {
    return (p.getType() & READDIR_CALLED) === READDIR_CALLED
  }

  cachedReaddir(entry: PathBase): PathBase[] {
    const { children, provisional } = entry
    return children.slice(0, provisional)
  }

  // asynchronous iterator for dir entries
  // not a "for await" async iterator, but an async function
  // that returns an iterable array.
  async readdir(entry: PathBase = this.cwd): Promise<PathBase[]> {
    const t = entry.getType()
    if ((t & ENOCHILD) !== 0) {
      return []
    }

    if (this.calledReaddir(entry)) {
      return this.cachedReaddir(entry)
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = this.fullpath(entry)
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
    return this.cachedReaddir(entry)
  }

  readdirSuccess(entry: PathBase) {
    // succeeded, mark readdir called bit
    entry.addType(READDIR_CALLED)
    // mark all remaining provisional children as ENOENT
    const { children, provisional } = entry
    for (let p = provisional; p < children.length; p++) {
      this.markENOENT(children[p])
    }
  }

  readdirAddChild(entry: PathBase, e: Dirent) {
    return (
      this.readdirMaybePromoteChild(entry, e) ||
      this.readdirAddNewChild(entry, e)
    )
  }

  readdirMaybePromoteChild(
    entry: PathBase,
    e: Dirent
  ): PathBase | undefined {
    const { children, provisional } = entry
    for (let p = provisional; p < children.length; p++) {
      const pchild = children[p]
      if (!this.matchName(pchild.matchName, e.name)) {
        continue
      }

      return this.readdirPromoteChild(entry, e, pchild, p)
    }
  }

  readdirPromoteChild(
    entry: PathBase,
    e: Dirent,
    p: PathBase,
    index: number
  ): PathBase {
    const { children, provisional } = entry
    const v = this.basename(p)
    const type = entToType(e)

    p.setType(type)
    // case sensitivity fixing when we learn the true name.
    if (v !== e.name) p.basename = e.name

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

  readdirAddNewChild(parent: PathBase, e: Dirent): PathBase {
    // alloc new entry at head, so it's never provisional
    const { children } = parent
    const type = entToType(e)
    const child = parent.newChild(e.name, type, { parent })
    children.unshift(child)
    parent.provisional++
    return child
  }

  readdirFail(entry: PathBase, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR' || er.code === 'EPERM') {
      this.markENOTDIR(entry)
    }
    if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

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

  markENOENT(entry: PathBase) {
    // mark as UNKNOWN and ENOENT
    const t = entry.getType()
    if (t & ENOENT) return
    entry.setType((t | ENOENT) & IFMT_UNKNOWN)
    this.markChildrenENOENT(entry)
  }

  markChildrenENOENT(entry: PathBase) {
    // all children are provisional
    entry.provisional = 0

    // all children do not exist
    for (const p of entry.children) {
      this.markENOENT(p)
    }
  }

  *readdirSync(entry: PathBase = this.cwd): Iterable<PathBase> {
    const t = entry.getType()
    if ((t & ENOCHILD) !== 0) {
      return
    }

    if (this.calledReaddir(entry)) {
      for (const e of this.cachedReaddir(entry)) yield e
      return
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = this.fullpath(entry)
    if (fullpath === undefined) {
      return
    }
    let finished = false
    try {
      const dir = opendirSync(fullpath)
      for (const e of syncDirIterate(dir)) {
        yield this.readdirAddChild(entry, e)
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

  matchName(a: string, b: string) {
    return a === b || (this.nocase && a === b.toLowerCase())
  }

  // fills in the data we can gather, or returns undefined on error
  async lstat(entry: PathBase = this.cwd): Promise<PathBase | undefined> {
    const t = entry.getType()
    if (t & ENOENT) {
      return
    }
    try {
      const path = this.fullpath(entry)
      if (!path) return
      entry.setType(entToType(await lstat(path)))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  lstatSync(entry: PathBase = this.cwd): PathBase | undefined {
    const t = entry.getType()
    if (t & ENOENT) {
      return
    }
    try {
      const path = this.fullpath(entry)
      if (!path) return
      entry.setType(entToType(lstatSync(path)))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  lstatFail(entry: PathBase, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR') {
      this.markENOTDIR(this.parent(entry))
    } else if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

  cannotReadlink(entry: PathBase): boolean {
    const t = entry.getType()
    // cases where it cannot possibly succeed
    return (
      !!((t & IFMT) !== UNKNOWN && !(t & IFLNK)) ||
      !!(t & ENOREADLINK) ||
      !!(t & ENOENT)
    )
  }

  async readlink(entry: PathBase): Promise<PathBase | undefined> {
    const target = entry.linkTarget
    if (target) {
      return target
    }
    if (this.cannotReadlink(entry)) {
      return undefined
    }
    const p = this.parent(entry)
    const fp = this.fullpath(entry)
    /* c8 ignore start */
    // already covered by the cannotReadlink test
    if (!fp || !p) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = await readlink(fp)
      const linkTarget = p.resolve(read)
      if (linkTarget) {
        return (entry.linkTarget = linkTarget)
      }
    } catch (er) {
      this.readlinkFail(entry, er as NodeJS.ErrnoException)
      return undefined
    }
  }

  readlinkFail(entry: PathBase, er: NodeJS.ErrnoException) {
    let ter: number = ENOREADLINK | (er.code === 'ENOENT' ? ENOENT : 0)
    if (er.code === 'EINVAL') {
      // exists, but not a symlink, we don't know WHAT it is, so remove
      // all IFMT bits.
      ter &= IFMT_UNKNOWN
    }
    if (er.code === 'ENOTDIR') {
      this.markENOTDIR(this.parent(entry))
    }
    entry.addType(ter)
  }

  readlinkSync(entry: PathBase): PathBase | undefined {
    const target = entry.linkTarget
    if (target) {
      return target
    }
    if (this.cannotReadlink(entry)) {
      return undefined
    }
    const p = this.parent(entry)
    const fp = this.fullpath(entry)
    /* c8 ignore start */
    // already covered by the cannotReadlink test
    if (!fp || !p) {
      return undefined
    }
    /* c8 ignore stop */
    try {
      const read = readlinkSync(fp)
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

  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    super(cwd, win32, opts)
    const { nocase = this.nocase } = opts
    this.nocase = nocase
  }

  parseRootPath(dir: string): string {
    // if the path starts with a single separator, it's not a UNC, and we'll
    // just get separator as the root, and driveFromUNC will return \
    // In that case, mount \ on the root from the cwd.
    const rootPath = win32.parse(dir).root
    const driveFromUNC = uncToDrive(rootPath)
    if (driveFromUNC === sep) {
      return driveCwd(win32.resolve(driveFromUNC)) + sep
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
  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    super(cwd, posix, opts)
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

export const PathWalker =
  process.platform === 'win32'
    ? PathWalkerWin32
    : process.platform === 'darwin'
    ? PathWalkerDarwin
    : PathWalkerPosix
