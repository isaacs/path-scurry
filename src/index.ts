import LRUCache from 'lru-cache'
import { posix, win32 } from 'path'

import {
  lstatSync,
  readdir as readdirCB,
  readdirSync,
  readlinkSync,
  realpathSync as rps,
} from 'fs'
const realpathSync = rps.native
// TODO: test perf of fs/promises realpath vs realpathCB,
// since the promises one uses realpath.native
import { lstat, readdir, readlink, realpath } from 'fs/promises'

import { Dirent, Stats } from 'fs'
import Minipass from 'minipass'

// turn something like //?/c:/ into c:\
const uncDriveRegexp = /^\\\\\?\\([a-z]:)\\?$/i
const uncToDrive = (rootPath: string): string =>
  rootPath.replace(/\//g, '\\').replace(uncDriveRegexp, '$1\\')

// windows paths are separated by either / or \
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
const READDIR_CALLED = 0b0000_0001_0000
// set after a successful lstat()
const LSTAT_CALLED = 0b0000_0010_0000
// set if an entry (or one of its parents) is definitely not a dir
const ENOTDIR = 0b0000_0100_0000
// set if an entry (or one of its parents) does not exist
// (can also be set on lstat errors like EACCES or ENAMETOOLONG)
const ENOENT = 0b0000_1000_0000
// cannot have child entries -- also verify &IFMT is either IFDIR or IFLNK
// set if we fail to readlink
const ENOREADLINK = 0b0001_0000_0000
// set if we know realpath() will fail
const ENOREALPATH = 0b0010_0000_0000

const ENOCHILD = ENOTDIR | ENOENT | ENOREALPATH
const TYPEMASK = 0b0011_1111_1111

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

/**
 * Options that may be provided to the Path constructor
 */
export interface PathOpts {
  fullpath?: string
  parent?: PathBase
}

/**
 * An LRUCache for storing resolved path strings or Path objects.
 * @internal
 */
export class ResolveCache extends LRUCache<string, string> {
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

/**
 * an LRUCache for storing child entries.
 * @internal
 */
export class ChildrenCache extends LRUCache<PathBase, Children> {
  constructor(maxSize: number = 16 * 1024) {
    super({
      maxSize,
      // parent + children
      sizeCalculation: a => a.length + 1,
    })
  }
}

/**
 * Array of Path objects, plus a marker indicating the first provisional entry
 *
 * @internal
 */
export type Children = PathBase[] & { provisional: number }

/**
 * Path objects are sort of like a super-powered
 * {@link https://nodejs.org/docs/latest/api/fs.html#class-fsdirent fs.Dirent}
 *
 * Each one represents a single filesystem entry on disk, which may or may not
 * exist. It includes methods for reading various types of information via
 * lstat, readlink, and readdir, and caches all information to the greatest
 * degree possible.
 *
 * Note that fs operations that would normally throw will instead return an
 * "empty" value. This is in order to prevent excessive overhead from error
 * stack traces.
 */
export abstract class PathBase implements Dirent {
  /**
   * the basename of this path
   */
  name: string
  /**
   * the Path entry corresponding to the path root.
   *
   * @internal
   */
  root: PathBase
  /**
   * All roots found within the current PathWalker family
   *
   * @internal
   */
  roots: { [k: string]: PathBase }
  /**
   * a reference to the parent path, or undefined in the case of root entries
   *
   * @internal
   */
  parent?: PathBase
  /**
   * boolean indicating whether paths are compared case-insensitively
   * @internal
   */
  nocase: boolean

  /**
   * the string or regexp used to split paths. On posix, it is `'/'`, and on
   * windows it is a RegExp matching either `'/'` or `'\\'`
   */
  abstract splitSep: string | RegExp
  /**
   * The path separator string to use when joining paths
   */
  abstract sep: string

  #matchName: string
  #fullpath?: string
  #type: number
  #children: ChildrenCache
  #linkTarget?: PathBase
  #realpath?: PathBase

  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathWalker class or other methods on the Path class.
   *
   * @internal
   */
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
    this.#children = children
    Object.assign(this, opts)
  }

  /**
   * @internal
   */
  abstract getRootString(path: string): string
  /**
   * @internal
   */
  abstract getRoot(rootPath: string): PathBase
  /**
   * @internal
   */
  abstract newChild(name: string, type?: number, opts?: PathOpts): PathBase

  /**
   * @internal
   */
  childrenCache() {
    return this.#children
  }

  /**
   * Get the Path object referenced by the string path, resolved from this Path
   */
  resolve(path?: string): PathBase {
    if (!path) {
      return this
    }
    const rootPath = this.getRootString(path)
    const dir = path.substring(rootPath.length)
    const dirParts = dir.split(this.splitSep)
    const result: PathBase = rootPath
      ? this.getRoot(rootPath).#resolveParts(dirParts)
      : this.#resolveParts(dirParts)
    return result
  }

  #resolveParts(dirParts: string[]) {
    let p: PathBase = this
    for (const part of dirParts) {
      p = p.child(part)
    }
    return p
  }

  /**
   * Returns the cached children Path objects, if still available.  If they
   * have fallen out of the cache, then returns an empty array, and resets the
   * READDIR_CALLED bit, so that future calls to readdir() will require an fs
   * lookup.
   *
   * @internal
   */
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

  /**
   * Resolves a path portion and returns or creates the child Path.
   *
   * Returns `this` if pathPart is `''` or `'.'`, or `parent` if pathPart is
   * `'..'`.
   *
   * This should not be called directly.  If `pathPart` contains any path
   * separators, it will lead to unsafe undefined behavior.
   *
   * Use `Path.resolve()` instead.
   *
   * @internal
   */
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

    if (!this.canReaddir()) {
      pchild.#type |= ENOENT
    }

    // don't have to update provisional, because if we have real children,
    // then provisional is set to children.length, otherwise a lower number
    children.push(pchild)
    return pchild
  }

  /**
   * The fully resolved path string for this Path entry
   */
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

  /**
   * Is the Path of an unknown type?
   *
   * Note that we might know *something* about it if there has been a previous
   * filesystem operation, for example that it does not exist, or is not a
   * link, or whether it has child entries.
   */
  isUnknown(): boolean {
    return (this.#type & IFMT) === UNKNOWN
  }

  /**
   * Is the Path a regular file?
   */
  isFile(): boolean {
    return (this.#type & IFMT) === IFREG
  }

  /**
   * Is the Path a directory?
   */
  isDirectory(): boolean {
    return (this.#type & IFMT) === IFDIR
  }

  /**
   * Is the path a character device?
   */
  isCharacterDevice(): boolean {
    return (this.#type & IFMT) === IFCHR
  }

  /**
   * Is the path a block device?
   */
  isBlockDevice(): boolean {
    return (this.#type & IFMT) === IFBLK
  }

  /**
   * Is the path a FIFO pipe?
   */
  isFIFO(): boolean {
    return (this.#type & IFMT) === IFIFO
  }

  /**
   * Is the path a socket?
   */
  isSocket(): boolean {
    return (this.#type & IFMT) === IFSOCK
  }

  /**
   * Is the path a symbolic link?
   */
  isSymbolicLink(): boolean {
    return (this.#type & IFLNK) === IFLNK
  }

  /**
   * Return the entry if it has been subject of a successful lstat, or
   * undefined otherwise.
   */
  lstatCached(): PathBase | undefined {
    return this.#type & LSTAT_CALLED ? this : undefined
  }

  /**
   * Return the cached link target if the entry has been the subject of a
   * successful readlink, or undefined otherwise.
   */
  readlinkCached(): PathBase | undefined {
    return this.#linkTarget
  }

  /**
   * Returns the cached realpath target if the entry has been the subject
   * of a successful realpath, or undefined otherwise.
   */
  realpathCached(): PathBase | undefined {
    return this.#realpath
  }

  /**
   * Returns the cached child Path entries array if the entry has been the
   * subject of a successful readdir(), or [] otherwise.
   */
  readdirCached(): PathBase[] {
    const children = this.children()
    return children.slice(0, children.provisional)
  }

  /**
   * Return the Path object corresponding to the target of a symbolic link.
   *
   * If the Path is not a symbolic link, or if the readlink call fails for any
   * reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   */
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
      this.#readlinkFail((er as NodeJS.ErrnoException).code)
      return undefined
    }
  }

  /**
   * Synchronous {@link PathBase.readlink}
   */
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
      this.#readlinkFail((er as NodeJS.ErrnoException).code)
      return undefined
    }
  }

  #cannotReadlink(): boolean {
    if (!this.parent) return true
    // cases where it cannot possibly succeed
    const ifmt = this.#type & IFMT
    return (
      !!(ifmt !== UNKNOWN && ifmt !== IFLNK) ||
      !!(this.#type & ENOREADLINK) ||
      !!(this.#type & ENOENT)
    )
  }

  #calledReaddir(): boolean {
    return !!(this.#type & READDIR_CALLED)
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

  #markENOREALPATH() {
    this.#type |= ENOREALPATH
    this.#markENOTDIR()
  }

  // save the information when we know the entry is not a dir
  #markENOTDIR() {
    // entry is not a directory, so any children can't exist.
    // this *should* be impossible, since any children created
    // after it's been marked ENOTDIR should be marked ENOENT,
    // so it won't even get to this point.
    /* c8 ignore start */
    if (this.#type & ENOTDIR) return
    /* c8 ignore stop */
    let t = this.#type
    // this could happen if we stat a dir, then delete it,
    // then try to read it or one of its children.
    if ((t & IFMT) === IFDIR) t &= IFMT_UNKNOWN
    this.#type = t | ENOTDIR
    this.#markChildrenENOENT()
  }

  #readdirFail(code: string = '') {
    // markENOTDIR and markENOENT also set provisional=0
    if (code === 'ENOTDIR' || code === 'EPERM') {
      this.#markENOTDIR()
    } else if (code === 'ENOENT') {
      this.#markENOENT()
    } else {
      this.children().provisional = 0
    }
  }

  #lstatFail(code: string = '') {
    // Windows just raises ENOENT in this case, disable for win CI
    /* c8 ignore start */
    if (code === 'ENOTDIR') {
      // already know it has a parent by this point
      const p = this.parent as PathBase
      p.#markENOTDIR()
    } else if (code === 'ENOENT') {
      /* c8 ignore stop */
      this.#markENOENT()
    }
  }

  #readlinkFail(code: string = '') {
    let ter = this.#type
    ter |= ENOREADLINK
    if (code === 'ENOENT') ter |= ENOENT
    // windows gets a weird error when you try to readlink a file
    if (code === 'EINVAL' || code === 'UNKNOWN') {
      // exists, but not a symlink, we don't know WHAT it is, so remove
      // all IFMT bits.
      ter &= IFMT_UNKNOWN
    }
    this.#type = ter
    // windows just gets ENOENT in this case.  We do cover the case,
    // just disabled because it's impossible on Windows CI
    /* c8 ignore start */
    if (code === 'ENOTDIR' && this.parent) {
      this.parent.#markENOTDIR()
    }
    /* c8 ignore stop */
  }

  #readdirAddChild(e: Dirent, c: Children) {
    return (
      this.#readdirMaybePromoteChild(e, c) ||
      this.#readdirAddNewChild(e, c)
    )
  }

  #readdirAddNewChild(e: Dirent, c: Children): PathBase {
    // alloc new entry at head, so it's never provisional
    const type = entToType(e)
    const child = this.newChild(e.name, type, { parent: this })
    const ifmt = child.#type & IFMT
    if (ifmt !== IFDIR && ifmt !== IFLNK && ifmt !== UNKNOWN) {
      child.#type |= ENOTDIR
    }
    c.unshift(child)
    c.provisional++
    return child
  }

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

  #readdirPromoteChild(
    e: Dirent,
    p: PathBase,
    index: number,
    c: Children
  ): PathBase {
    const v = p.name
    // retain any other flags, but set ifmt from dirent
    p.#type = (p.#type & IFMT_UNKNOWN) | entToType(e)
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

  /**
   * Call lstat() on this Path, and update all known information that can be
   * determined.
   *
   * Note that unlike `fs.lstat()`, the returned value does not contain some
   * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
   * information is required, you will need to call `fs.lstat` yourself.
   *
   * If the Path refers to a nonexistent file, or if the lstat call fails for
   * any reason, `undefined` is returned.  Otherwise the updated Path object is
   * returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async lstat(): Promise<PathBase | undefined> {
    if ((this.#type & ENOENT) === 0) {
      try {
        // retain any other flags, but set the ifmt
        const ifmt = entToType(await lstat(this.fullpath()))
        this.#type = (this.#type & IFMT_UNKNOWN) | ifmt | LSTAT_CALLED
        if (ifmt !== UNKNOWN && ifmt !== IFDIR && ifmt !== IFLNK) {
          this.#type |= ENOTDIR
        }
        return this
      } catch (er) {
        this.#lstatFail((er as NodeJS.ErrnoException).code)
      }
    }
  }

  /**
   * synchronous {@link PathBase.lstat}
   */
  lstatSync(): PathBase | undefined {
    if ((this.#type & ENOENT) === 0) {
      try {
        // retain any other flags, but set the ifmt
        const ifmt = entToType(lstatSync(this.fullpath()))
        this.#type = (this.#type & IFMT_UNKNOWN) | ifmt | LSTAT_CALLED
        if (ifmt !== UNKNOWN && ifmt !== IFDIR && ifmt !== IFLNK) {
          this.#type |= ENOTDIR
        }
        return this
      } catch (er) {
        this.#lstatFail((er as NodeJS.ErrnoException).code)
      }
    }
  }

  /**
   * Standard node-style callback interface to get list of directory entries.
   *
   * If the Path cannot or does not contain any children, then an empty array
   * is returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   *
   * @param cb The callback called with (er, entries).  Note that the `er`
   * param is somewhat extraneous, as all readdir() errors are handled and
   * simply result in an empty set of entries being returned.
   * @param allowZalgo Boolean indicating that immediately known results should
   * *not* be deferred with `queueMicrotask`. Defaults to `false`. Release
   * zalgo at your peril, the dark pony lord is devious and unforgiving.
   */
  readdirCB(
    cb: (er: NodeJS.ErrnoException | null, entries: PathBase[]) => any,
    allowZalgo: boolean = false
  ): void {
    if (!this.canReaddir()) {
      if (allowZalgo) cb(null, [])
      else queueMicrotask(() => cb(null, []))
      return
    }

    const children = this.children()
    if (this.#calledReaddir()) {
      const c = children.slice(0, children.provisional)
      if (allowZalgo) cb(null, c)
      else queueMicrotask(() => cb(null, c))
      return
    }

    // else read the directory, fill up children
    // de-provisionalize any provisional children.
    const fullpath = this.fullpath()
    readdirCB(fullpath, { withFileTypes: true }, (er, entries) => {
      if (er) {
        this.#readdirFail((er as NodeJS.ErrnoException).code)
        children.provisional = 0
      } else {
        for (const e of entries) {
          this.#readdirAddChild(e, children)
        }
        this.#readdirSuccess(children)
      }
      cb(null, children.slice(0, children.provisional))
      return
    })
  }

  /**
   * Return an array of known child entries.
   *
   * If the Path cannot or does not contain any children, then an empty array
   * is returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async readdir(): Promise<PathBase[]> {
    if (!this.canReaddir()) {
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
      this.#readdirFail((er as NodeJS.ErrnoException).code)
      children.provisional = 0
    }
    return children.slice(0, children.provisional)
  }

  /**
   * synchronous {@link PathBase.readdir}
   */
  readdirSync(): PathBase[] {
    if (!this.canReaddir()) {
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
      this.#readdirFail((er as NodeJS.ErrnoException).code)
      children.provisional = 0
    }
    return children.slice(0, children.provisional)
  }

  canReaddir() {
    if (this.#type & ENOCHILD) return false
    const ifmt = IFMT & this.#type
    // we always set ENOTDIR when setting IFMT, so should be impossible
    /* c8 ignore start */
    if (!(ifmt === UNKNOWN || ifmt === IFDIR || ifmt === IFLNK)) {
      return false
    }
    /* c8 ignore stop */
    return true
  }

  shouldWalk(
    dirs: Set<PathBase | undefined>,
    walkFilter?: (e: PathBase) => boolean
  ): boolean {
    return (
      (this.#type & IFDIR) === IFDIR &&
      !(this.#type & ENOCHILD) &&
      !dirs.has(this) &&
      (!walkFilter || walkFilter(this))
    )
  }

  /**
   * Return the Path object corresponding to path as resolved
   * by realpath(3).
   *
   * If the realpath call fails for any reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   * On success, returns a Path object.
   */
  async realpath(): Promise<PathBase | undefined> {
    if (this.#realpath) return this.#realpath
    if ((ENOREALPATH | ENOREADLINK | ENOENT) & this.#type) return undefined
    try {
      const rp = await realpath(this.fullpath())
      return (this.#realpath = this.resolve(rp))
    } catch (_) {
      this.#markENOREALPATH()
    }
  }

  /**
   * Synchronous {@link realpath}
   */
  realpathSync(): PathBase | undefined {
    if (this.#realpath) return this.#realpath
    if ((ENOREALPATH | ENOREADLINK | ENOENT) & this.#type) return undefined
    try {
      const rp = realpathSync(this.fullpath())
      return (this.#realpath = this.resolve(rp))
    } catch (_) {
      this.#markENOREALPATH()
    }
  }
}

/**
 * Path class used on win32 systems
 *
 * Uses `'\\'` as the path separator for returned paths, either `'\\'` or `'/'`
 * as the path separator for parsing paths.
 */
export class PathWin32 extends PathBase {
  /**
   * Separator for generating path strings.
   */
  sep: '\\' = '\\'
  /**
   * Separator for parsing path strings.
   */
  splitSep: RegExp = eitherSep

  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathWalker class or other methods on the Path class.
   *
   * @internal
   */
  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean,
    children: ChildrenCache,
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, children, opts)
  }

  /**
   * @internal
   */
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

  /**
   * @internal
   */
  getRootString(path: string): string {
    return win32.parse(path).root
  }

  /**
   * @internal
   */
  getRoot(rootPath: string): PathBase {
    rootPath = uncToDrive(rootPath.toUpperCase())
    if (rootPath === this.root.name) {
      return this.root
    }
    // ok, not that one, check if it matches another we know about
    for (const [compare, root] of Object.entries(this.roots)) {
      if (this.sameRoot(rootPath, compare)) {
        return (this.roots[rootPath] = root)
      }
    }
    // otherwise, have to create a new one.
    return (this.roots[rootPath] = new PathWalkerWin32(
      rootPath,
      this
    ).root)
  }

  /**
   * @internal
   */
  sameRoot(rootPath: string, compare: string = this.root.name): boolean {
    // windows can (rarely) have case-sensitive filesystem, but
    // UNC and drive letters are always case-insensitive, and canonically
    // represented uppercase.
    rootPath = rootPath
      .toUpperCase()
      .replace(/\//g, '\\')
      .replace(uncDriveRegexp, '$1\\')
    return rootPath === compare
  }
}

/**
 * Path class used on all posix systems.
 *
 * Uses `'/'` as the path separator.
 */
export class PathPosix extends PathBase {
  /**
   * separator for parsing path strings
   */
  splitSep: '/' = '/'
  /**
   * separator for generating path strings
   */
  sep: '/' = '/'

  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathWalker class or other methods on the Path class.
   *
   * @internal
   */
  constructor(
    name: string,
    type: number = UNKNOWN,
    root: PathBase | undefined,
    roots: { [k: string]: PathBase },
    nocase: boolean,
    children: ChildrenCache,
    opts: PathOpts
  ) {
    super(name, type, root, roots, nocase, children, opts)
  }

  /**
   * @internal
   */
  getRootString(path: string): string {
    return path.startsWith('/') ? '/' : ''
  }

  /**
   * @internal
   */
  getRoot(_rootPath: string): PathBase {
    return this.root
  }

  /**
   * @internal
   */
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

/**
 * Options that may be provided to the PathWalker constructor
 */
export interface PathWalkerOpts {
  /**
   * perform case-insensitive path matching. Default based on platform
   * subclass.
   */
  nocase?: boolean
  /**
   * Number of Path entries to keep in the cache of Path child references.
   *
   * Setting this higher than 65536 will dramatically increase the data
   * consumption and construction time overhead of each PathWalker.
   *
   * Setting this value to 256 or lower will significantly reduce the data
   * consumption and construction time overhead, but may also reduce resolve()
   * and readdir() performance on large filesystems.
   *
   * Default `16384`.
   */
  childrenCacheSize?: number
}

/**
 * The base class for all PathWalker classes, providing the interface for path
 * resolution and filesystem operations.
 *
 * Typically, you should *not* instantiate this class directly, but rather one
 * of the platform-specific classes, or the exported {@link PathWalker} which
 * defaults to the current platform.
 */
export abstract class PathWalkerBase {
  /**
   * The root Path entry for the current working directory of this walker
   */
  root: PathBase
  /**
   * The string path for the root of this walker's current working directory
   */
  rootPath: string
  /**
   * A collection of all roots encountered, referenced by rootPath
   */
  roots: { [k: string]: PathBase }
  /**
   * The Path entry corresponding to this PathWalker's current working directory.
   */
  cwd: PathBase
  #resolveCache: ResolveCache
  #children: ChildrenCache
  /**
   * Perform path comparisons case-insensitively.
   *
   * Defaults true on Darwin and Windows systems, false elsewhere.
   */
  nocase: boolean

  /**
   * The path separator used for parsing paths
   *
   * `'/'` on Posix systems, either `'/'` or `'\\'` on Windows
   */
  abstract sep: string | RegExp

  /**
   * This class should not be instantiated directly.
   *
   * Use PathWalkerWin32, PathWalkerDarwin, PathWalkerPosix, or PathWalker
   *
   * @internal
   */
  constructor(
    cwd: string = process.cwd(),
    pathImpl: typeof win32 | typeof posix,
    sep: string | RegExp,
    { nocase, childrenCacheSize = 16 * 1024 }: PathWalkerOpts = {}
  ) {
    // resolve and split root, and then add to the store.
    // this is the only time we call path.resolve()
    const cwdPath = pathImpl.resolve(cwd)
    this.roots = Object.create(null)
    this.rootPath = this.parseRootPath(cwdPath)
    this.#resolveCache = new ResolveCache()
    this.#children = new ChildrenCache(childrenCacheSize)

    const split = cwdPath.substring(this.rootPath.length).split(sep)
    // resolve('/') leaves '', splits to [''], we don't want that.
    if (split.length === 1 && !split[0]) {
      split.pop()
    }
    /* c8 ignore start */
    if (nocase === undefined) {
      throw new TypeError(
        'must provide nocase setting to PathWalkerBase ctor'
      )
    }
    /* c8 ignore stop */
    this.nocase = nocase
    this.root = this.newRoot()
    this.roots[this.rootPath] = this.root
    let prev: PathBase = this.root
    for (const part of split) {
      prev = prev.child(part)
    }
    this.cwd = prev
  }

  /**
   * Parse the root portion of a path string
   *
   * @internal
   */
  abstract parseRootPath(dir: string): string
  /**
   * create a new Path to use as root during construction.
   *
   * @internal
   */
  abstract newRoot(): PathBase
  /**
   * Determine whether a given path string is absolute
   */
  abstract isAbsolute(p: string): boolean

  /**
   * Return the cache of child entries.  Exposed so subclasses can create
   * child Path objects in a platform-specific way.
   *
   * @internal
   */
  childrenCache() {
    return this.#children
  }

  /**
   * Resolve one or more path strings to a resolved string
   *
   * Same interface as require('path').resolve.
   *
   * Much faster than path.resolve() when called multiple times for the same
   * path, because the resolved Path objects are cached.  Much slower
   * otherwise.
   */
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

  /**
   * Return the basename for the provided string or Path object
   */
  basename(entry: PathBase | string = this.cwd): string {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.name
  }

  /**
   * Return the dirname for the provided string or Path object
   */
  dirname(entry: PathBase | string = this.cwd): string {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return (entry.parent || entry).fullpath()
  }

  /**
   * Return an array of known child entries.
   *
   * First argument may be either a string, or a Path object.
   *
   * If the Path cannot or does not contain any children, then an empty array
   * is returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   *
   * Unlike `fs.readdir()`, the `withFileTypes` option defaults to `true`. Set
   * `{ withFileTypes: false }` to return strings.
   */
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
    if (!entry.canReaddir()) {
      return []
    } else {
      const p = await entry.readdir()
      return withFileTypes ? p : p.map(e => e.name)
    }
  }

  /**
   * synchronous {@link PathWalkerBase.readdir}
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
    if (!entry.canReaddir()) {
      return []
    } else if (withFileTypes) {
      return entry.readdirSync()
    } else {
      return entry.readdirSync().map(e => e.name)
    }
  }

  /**
   * Call lstat() on the string or Path object, and update all known
   * information that can be determined.
   *
   * Note that unlike `fs.lstat()`, the returned value does not contain some
   * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
   * information is required, you will need to call `fs.lstat` yourself.
   *
   * If the Path refers to a nonexistent file, or if the lstat call fails for
   * any reason, `undefined` is returned.  Otherwise the updated Path object is
   * returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async lstat(
    entry: string | PathBase = this.cwd
  ): Promise<PathBase | undefined> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.lstat()
  }

  /**
   * synchronous {@link PathWalkerBase.lstat}
   */
  lstatSync(entry: string | PathBase = this.cwd): PathBase | undefined {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    return entry.lstatSync()
  }

  /**
   * Return the Path object or string path corresponding to the target of a
   * symbolic link.
   *
   * If the path is not a symbolic link, or if the readlink call fails for any
   * reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   *
   * `{withFileTypes}` option defaults to `false`.
   *
   * On success, returns a Path object if `withFileTypes` option is true,
   * otherwise a string.
   */
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

  /**
   * synchronous {@link PathWalkerBase.readlink}
   */
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

  /**
   * Return the Path object or string path corresponding to path as resolved
   * by realpath(3).
   *
   * If the realpath call fails for any reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   *
   * `{withFileTypes}` option defaults to `false`.
   *
   * On success, returns a Path object if `withFileTypes` option is true,
   * otherwise a string.
   */
  realpath(
    entry: string | PathBase,
    opt?: { withFileTypes: false }
  ): Promise<string | undefined>
  realpath(
    entry: string | PathBase,
    opt: { withFileTypes: true }
  ): Promise<PathBase | undefined>
  realpath(
    entry: string | PathBase,
    opt: { withFileTypes: boolean }
  ): Promise<string | PathBase | undefined>
  async realpath(
    entry: string | PathBase,
    { withFileTypes }: { withFileTypes: boolean } = {
      withFileTypes: false,
    }
  ): Promise<string | PathBase | undefined> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const e = await entry.realpath()
    return withFileTypes ? e : e?.fullpath()
  }

  realpathSync(
    entry: string | PathBase,
    opt?: { withFileTypes: false }
  ): string | undefined
  realpathSync(
    entry: string | PathBase,
    opt: { withFileTypes: true }
  ): PathBase | undefined
  realpathSync(
    entry: string | PathBase,
    opt: { withFileTypes: boolean }
  ): string | PathBase | undefined
  realpathSync(
    entry: string | PathBase,
    { withFileTypes }: { withFileTypes: boolean } = {
      withFileTypes: false,
    }
  ): string | PathBase | undefined {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const e = entry.realpathSync()
    return withFileTypes ? e : e?.fullpath()
  }

  /**
   * Asynchronously walk the directory tree, returning an array of
   * all path strings or Path objects found.
   *
   * Note that this will be extremely memory-hungry on large filesystems.
   * In such cases, it may be better to use the stream or async iterator
   * walk implementation.
   */
  walk(entry?: string | PathBase): Promise<PathBase[]>
  walk(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset
  ): Promise<PathBase[]>
  walk(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): Promise<string[]>
  walk(
    entry: string | PathBase,
    opts: WalkOptions
  ): Promise<PathBase[] | string[]>
  async walk(
    entry: string | PathBase = this.cwd,
    {
      withFileTypes = true,
      follow = false,
      filter,
      walkFilter,
    }: WalkOptions = {}
  ): Promise<PathBase[] | string[]> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const results: (string | PathBase)[] = []
    if (!filter || filter(entry)) {
      results.push(withFileTypes ? entry : entry.fullpath())
    }
    const dirs = new Set<PathBase>()
    const walk = (
      dir: PathBase,
      cb: (er?: NodeJS.ErrnoException) => void
    ) => {
      dirs.add(dir)
      dir.readdirCB((er, entries) => {
        /* c8 ignore start */
        if (er) {
          return cb(er)
        }
        /* c8 ignore stop */
        let len = entries.length
        if (!len) return cb()
        const next = () => {
          if (--len === 0) {
            cb()
          }
        }
        for (const e of entries) {
          if (!filter || filter(e)) {
            results.push(withFileTypes ? e : e.fullpath())
          }
          if (follow && e.isSymbolicLink()) {
            e.realpath()
              .then(r => (r?.isUnknown() ? r.lstat() : r))
              .then(r =>
                r?.shouldWalk(dirs, walkFilter) ? walk(r, next) : next()
              )
          } else {
            if (e.shouldWalk(dirs, walkFilter)) {
              walk(e, next)
            } else {
              next()
            }
          }
        }
      }, true) // zalgooooooo
    }

    const start = entry
    return new Promise<PathBase[] | string[]>((res, rej) => {
      walk(start, er => {
        /* c8 ignore start */
        if (er) return rej(er)
        /* c8 ignore stop */
        res(results as PathBase[] | string[])
      })
    })
  }

  /**
   * Synchronously walk the directory tree, returning an array of
   * all path strings or Path objects found.
   *
   * Note that this will be extremely memory-hungry on large filesystems.
   * In such cases, it may be better to use the stream or async iterator
   * walk implementation.
   */
  walkSync(entry?: string | PathBase): PathBase[]
  walkSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue
  ): PathBase[]
  walkSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): string[]
  walkSync(
    entry: string | PathBase,
    opts: WalkOptions
  ): PathBase[] | string[]
  walkSync(
    entry: string | PathBase = this.cwd,
    {
      withFileTypes = true,
      follow = false,
      filter,
      walkFilter,
    }: WalkOptions = {}
  ): PathBase[] | string[] {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const results: (string | PathBase)[] = []
    if (!filter || filter(entry)) {
      results.push(withFileTypes ? entry : entry.fullpath())
    }
    const dirs = new Set<PathBase>([entry])
    for (const dir of dirs) {
      const entries = dir.readdirSync()
      for (const e of entries) {
        if (!filter || filter(e)) {
          results.push(withFileTypes ? e : e.fullpath())
        }
        let r: PathBase | undefined = e
        if (e.isSymbolicLink()) {
          if (!(follow && (r = e.realpathSync()))) continue
          if (r.isUnknown()) r.lstatSync()
        }
        if (r.shouldWalk(dirs, walkFilter)) {
          dirs.add(r)
        }
      }
    }
    return results as string[] | PathBase[]
  }

  /**
   * Support for `for await`
   *
   * Alias for {@link PathWalkerBase.iterate}
   *
   * Note: As of Node 19, this is very slow, compared to other methods of
   * walking.  Consider using {@link PathWalkerBase.stream} if memory overhead
   * and backpressure are concerns, or {@link PathWalkerBase.walk} if not.
   */
  [Symbol.asyncIterator]() {
    return this.iterate()
  }

  /**
   * Async generator form of {@link PathWalkerBase.walk}
   *
   * Note: As of Node 19, this is very slow, compared to other methods of
   * walking, especially if most/all of the directory tree has been previously
   * walked.  Consider using {@link PathWalkerBase.stream} if memory overhead
   * and backpressure are concerns, or {@link PathWalkerBase.walk} if not.
   */
  iterate(entry?: string | PathBase): AsyncGenerator<PathBase, void, void>
  iterate(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset
  ): AsyncGenerator<PathBase, void, void>
  iterate(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): AsyncGenerator<string, void, void>
  iterate(
    entry: string | PathBase,
    opts: WalkOptions
  ): AsyncGenerator<PathBase | string, void, void>
  iterate(
    entry: string | PathBase = this.cwd,
    options: WalkOptions = {}
  ): AsyncGenerator<PathBase | string, void, void> {
    // iterating async over the stream is significantly more performant,
    // especially in the warm-cache scenario, because it buffers up directory
    // entries in the background instead of waiting for a yield for each one.
    return this.stream(entry, options)[Symbol.asyncIterator]()
  }

  /**
   * Iterating over a PathWalker performs a synchronous walk.
   *
   * Alias for {@link PathWalkerBase.syncIterate}
   */
  [Symbol.iterator]() {
    return this.iterateSync()
  }

  iterateSync(entry?: string | PathBase): Generator<PathBase, void, void>
  iterateSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset
  ): Generator<PathBase, void, void>
  iterateSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): Generator<string, void, void>
  iterateSync(
    entry: string | PathBase,
    opts: WalkOptions
  ): Generator<PathBase | string, void, void>
  *iterateSync(
    entry: string | PathBase = this.cwd,
    {
      withFileTypes = true,
      follow = false,
      filter,
      walkFilter,
    }: WalkOptions = {}
  ): Generator<PathBase | string, void, void> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    if (!filter || filter(entry)) {
      yield withFileTypes ? entry : entry.fullpath()
    }
    const dirs = new Set<PathBase>([entry])
    for (const dir of dirs) {
      const entries = dir.readdirSync()
      for (const e of entries) {
        if (!filter || filter(e)) {
          yield withFileTypes ? e : e.fullpath()
        }
        let r: PathBase | undefined = e
        if (e.isSymbolicLink()) {
          if (!(follow && (r = e.realpathSync()))) continue
          if (r.isUnknown()) r.lstatSync()
        }
        if (r.shouldWalk(dirs, walkFilter)) {
          dirs.add(r)
        }
      }
    }
  }

  /**
   * Stream form of {@link PathWalkerBase.walk}
   *
   * Returns a Minipass stream that emits {@link PathBase} objects by default,
   * or strings if `{ withFileTypes: false }` is set in the options.
   */
  stream(entry?: string | PathBase): Minipass<PathBase>
  stream(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue
  ): Minipass<PathBase>
  stream(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): Minipass<string>
  stream(
    entry: string | PathBase,
    opts: WalkOptions
  ): Minipass<string> | Minipass<PathBase>
  stream(
    entry: string | PathBase = this.cwd,
    {
      withFileTypes = true,
      follow = false,
      filter,
      walkFilter,
    }: WalkOptions = {}
  ): Minipass<string> | Minipass<PathBase> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const results = new Minipass<string | PathBase>({ objectMode: true })
    if (!filter || filter(entry)) {
      results.write(withFileTypes ? entry : entry.fullpath())
    }
    const dirs = new Set<PathBase>()
    const queue: PathBase[] = [entry]
    let processing = 0
    const process = () => {
      let paused = false
      while (!paused) {
        const dir = queue.shift()
        if (!dir) {
          if (processing === 0) results.end()
          return
        }

        processing++
        dirs.add(dir)

        const onReaddir = (
          er: null | NodeJS.ErrnoException,
          entries: PathBase[],
          didRealpaths: boolean = false
        ) => {
          /* c8 ignore start */
          if (er) return results.emit('error', er)
          /* c8 ignore stop */
          if (follow && !didRealpaths) {
            const promises: Promise<PathBase | undefined>[] = []
            for (const e of entries) {
              if (e.isSymbolicLink()) {
                promises.push(
                  e
                    .realpath()
                    .then((r: PathBase | undefined) =>
                      r?.isUnknown() ? r.lstat() : r
                    )
                )
              }
            }
            if (promises.length) {
              Promise.all(promises).then(() =>
                onReaddir(null, entries, true)
              )
              return
            }
          }

          for (const e of entries) {
            if (e && (!filter || filter(e))) {
              if (!results.write(withFileTypes ? e : e.fullpath())) {
                paused = true
              }
            }
          }

          processing--
          for (const e of entries) {
            const r = e.realpathCached() || e
            if (r.shouldWalk(dirs, walkFilter)) {
              queue.push(r)
            }
          }
          if (paused && !results.flowing) {
            results.once('drain', process)
          } else if (!sync) {
            process()
          }
        }

        // zalgo containment
        let sync = true
        dir.readdirCB(onReaddir, true)
        sync = false
      }
    }
    process()
    return results as Minipass<string> | Minipass<PathBase>
  }

  /**
   * Synchronous form of {@link PathWalkerBase.stream}
   *
   * Returns a Minipass stream that emits {@link PathBase} objects by default,
   * or strings if `{ withFileTypes: false }` is set in the options.
   *
   * Will complete the walk in a single tick if the stream is consumed fully.
   * Otherwise, will pause as needed for stream backpressure.
   */
  streamSync(entry?: string | PathBase): Minipass<PathBase>
  streamSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue
  ): Minipass<PathBase>
  streamSync(
    entry: string | PathBase,
    opts: WalkOptionsWithFileTypesFalse
  ): Minipass<string>
  streamSync(
    entry: string | PathBase,
    opts: WalkOptions
  ): Minipass<PathBase> | Minipass<string>
  streamSync(
    entry: string | PathBase = this.cwd,
    {
      withFileTypes = true,
      follow = false,
      filter,
      walkFilter,
    }: WalkOptions = {}
  ): Minipass<string> | Minipass<PathBase> {
    if (typeof entry === 'string') {
      entry = this.cwd.resolve(entry)
    }
    const results = new Minipass<string | PathBase>({ objectMode: true })
    const dirs = new Set<PathBase>()
    if (!filter || filter(entry)) {
      results.write(withFileTypes ? entry : entry.fullpath())
    }
    const queue: PathBase[] = [entry]
    let processing = 0
    const process = () => {
      let paused = false
      while (!paused) {
        const dir = queue.shift()
        if (!dir) {
          if (processing === 0) results.end()
          return
        }
        processing++
        dirs.add(dir)

        const entries = dir.readdirSync()
        for (const e of entries) {
          if (!filter || filter(e)) {
            if (!results.write(withFileTypes ? e : e.fullpath())) {
              paused = true
            }
          }
        }
        processing--
        for (const e of entries) {
          let r: PathBase | undefined = e
          if (e.isSymbolicLink()) {
            if (!(follow && (r = e.realpathSync()))) continue
            if (r.isUnknown()) r.lstatSync()
          }
          if (r.shouldWalk(dirs, walkFilter)) {
            queue.push(r)
          }
        }
      }
      if (paused && !results.flowing) results.once('drain', process)
    }
    process()
    return results as Minipass<string> | Minipass<PathBase>
  }
}

/**
 * Options provided to all walk methods.
 */
export interface WalkOptions {
  /**
   * Return results as {@link PathBase} objects rather than strings.
   * When set to false, results are fully resolved paths, as returned by
   * {@link PathBase.fullpath}.
   * @default true
   */
  withFileTypes?: boolean

  /**
   *  Attempt to read directory entries from symbolic links. Otherwise, only
   *  actual directories are traversed. Regardless of this setting, a given
   *  target path will only ever be walked once, meaning that a symbolic link
   *  to a previously traversed directory will never be followed.
   *
   *  Setting this imposes a slight performance penalty, because `readlink`
   *  must be called on all symbolic links encountered, in order to avoid
   *  infinite cycles.
   * @default false
   */
  follow?: boolean

  /**
   * Only return entries where the provided function returns true.
   *
   * This will not prevent directories from being traversed, even if they do
   * not pass the filter, though it will prevent directories themselves from
   * being included in the result set.  See {@link walkFilter}
   *
   * Asynchronous functions are not supported here.
   *
   * By default, if no filter is provided, all entries and traversed
   * directories are included.
   */
  filter?: (entry: PathBase) => boolean

  /**
   * Only traverse directories (and in the case of {@link follow} being set to
   * true, symbolic links to directories) if the provided function returns
   * true.
   *
   * This will not prevent directories from being included in the result set,
   * even if they do not pass the supplied filter function.  See {@link filter}
   * to do that.
   *
   * Asynchronous functions are not supported here.
   */
  walkFilter?: (entry: PathBase) => boolean
}

type WalkOptionsWithFileTypesUnset = Pick<
  WalkOptions,
  Exclude<keyof WalkOptions, 'withFileTypes'>
>
type WalkOptionsWithFileTypesTrue = WalkOptions & {
  withFileTypes: true
}
type WalkOptionsWithFileTypesFalse = WalkOptions & {
  withFileTypes: false
}

/**
 * Windows implementation of {@link PathWalkerBase}
 *
 * Defaults to case insensitve, uses `'\\'` to generate path strings.  Uses
 * {@link PathWin32} for Path objects.
 */
export class PathWalkerWin32 extends PathWalkerBase {
  /**
   * separator for generating path strings
   */
  sep: '\\' = '\\'

  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    const { nocase = true } = opts
    super(cwd, win32, '\\', { ...opts, nocase })
    this.nocase = nocase
    for (let p: PathBase | undefined = this.cwd; p; p = p.parent) {
      p.nocase = this.nocase
    }
  }

  /**
   * @internal
   */
  parseRootPath(dir: string): string {
    // if the path starts with a single separator, it's not a UNC, and we'll
    // just get separator as the root, and driveFromUNC will return \
    // In that case, mount \ on the root from the cwd.
    return win32.parse(dir).root.toUpperCase()
  }

  /**
   * @internal
   */
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

  /**
   * Return true if the provided path string is an absolute path
   */
  isAbsolute(p: string): boolean {
    return (
      p.startsWith('/') || p.startsWith('\\') || /^[a-z]:(\/|\\)/i.test(p)
    )
  }
}

/**
 * {@link PathWalkerBase} implementation for all posix systems other than Darwin.
 *
 * Defaults to case-sensitive matching, uses `'/'` to generate path strings.
 *
 * Uses {@link PathPosix} for Path objects.
 */
export class PathWalkerPosix extends PathWalkerBase {
  /**
   * separator for generating path strings
   */
  sep: '/' = '/'
  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    const { nocase = false } = opts
    super(cwd, posix, '/', { ...opts, nocase })
    this.nocase = nocase
  }

  /**
   * @internal
   */
  parseRootPath(_dir: string): string {
    return '/'
  }

  /**
   * @internal
   */
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

  /**
   * Return true if the provided path string is an absolute path
   */
  isAbsolute(p: string): boolean {
    return p.startsWith('/')
  }
}

/**
 * {@link PathWalkerBase} implementation for Darwin (macOS) systems.
 *
 * Defaults to case-insensitive matching, uses `'/'` for generating path
 * strings.
 *
 * Uses {@link PathPosix} for Path objects.
 */
export class PathWalkerDarwin extends PathWalkerPosix {
  constructor(cwd: string = process.cwd(), opts: PathWalkerOpts = {}) {
    const { nocase = true } = opts
    super(cwd, { ...opts, nocase })
  }
}

/**
 * Default {@link PathBase} implementation for the current platform.
 *
 * {@link PathWin32} on Windows systems, {@link PathPosix} on all others.
 */
export const Path = process.platform === 'win32' ? PathWin32 : PathPosix
export type Path = PathBase | InstanceType<typeof Path>

/**
 * Default {@link PathWalkerBase} implementation for the current platform.
 *
 * {@link PathWalkerWin32} on Windows systems, {@link PathWalkerDarwin} on
 * Darwin (macOS) systems, {@link PathWalkerPosix} on all others.
 */
export const PathWalker:
  | typeof PathWalkerWin32
  | typeof PathWalkerDarwin
  | typeof PathWalkerPosix =
  process.platform === 'win32'
    ? PathWalkerWin32
    : process.platform === 'darwin'
    ? PathWalkerDarwin
    : PathWalkerPosix
export type PathWalker = PathWalkerBase | InstanceType<typeof PathWalker>
