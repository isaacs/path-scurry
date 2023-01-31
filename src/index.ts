import { resolve, sep } from 'path'

import { Dir, lstatSync, opendirSync, readlinkSync } from 'fs'
import { lstat, opendir, readlink } from 'fs/promises'

import { Dirent, Stats } from 'fs'
import { parse } from 'path/posix'
import { nullPointer, Pointer, PointerSet } from 'pointer-set'

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
const uncRegexp = /^\\\\\?\\([a-z]:)\\?$/
const unUNCDrive = (rootPath: string): string =>
  rootPath.replace(/\//g, '\\').replace(uncRegexp, '$1:\\')

const isWindows = process.platform === 'win32'
const isDarwin = process.platform === 'darwin'
const defNocase = isWindows || isDarwin
const driveCwd = (c: string) => c.match(/^([a-z]):(?:\\|\/|$)/)?.[1]
const eitherSep = /[\\\/]/
const splitSep = isWindows ? eitherSep : sep

// a PathWalker has a PointerSet with the following setup:
// - value: the string representing the path portion, using
//   `/` for posix root paths.
// - type: a raw uint32 field:
//    - low 4 bits are the S_IFMT nibble, or 0 for "unknown"
//    - remaining bits are used for various helpful flags.
// - parent: pointer to parent directory
// - chead: start of linked list of child entries
// - ctail: end of linked list of child entries
// - next: next sibling entry in the same directory
// - prev: previous sibling entry in the same directory
// - linkTarget: pointer to path entry that symlink references, if known
//
// Each PathWalker has a single root, but they can share the same store,
// so you could potentially have multiple entries in the store that are
// parentless, even though each PathWalker only has a single root entry.

// PROVISIONAL CHILDREN vs REAL CHILDREN
// each entry has chead and ctail, which define the entire set of children
// they also have a phead which is the first "provisional" child, ie a
// child entry that has not been the subject of a readdir() walk or explicit
// lstat.
//
// when we call pw.child(parent, pathPart) we search the list of children
// for any child entry between chead and ctail, and return it if found,
// otherwise insert at phead.  If phead not set, then it's the new entry
// appended to ctail.  If it is set, then just append to ctail.
//
// when we call pw.readdir() and READDIR_CALLED bit is set, return the list
// of children from chead to before phead.
// If READDIR_CALLED is *not* set, but chead and phead are set, then for
// each entry returned from the fs.Dir iterator, search from phead to ctail
// to see a matching entry.  If found, and equal to phead, then advance phead
// (which might set phead to nullPointer if phead was equal to ctail).
// If found and not phead, move to behind phead.  Otherwise, create a new
// entry and insert behind phead.
// If READDIR_CALLED is not set, and chead and phead are not set, then just
// build the list and don't set phead.
// There should never be a case where phead is set, but chead and ctail are
// not set.
// There should never be a case where READDIR_CALLED is set, and chead/ctail
// are not set.
// There should never be a case where READDIR_CALLED is not set, and chead
// is not equal to phead.
// The only case where READDIR_CALLED will be set, and chead will be equal
// to phead, is if there are no actual children, only provisional ones. And
// in that case, we can bail out of readdir early.

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
const ENOCHILD = ENOTDIR | ENOENT
// set if we fail to readlink
const ENOREADLINK = 0b1000_0000

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

const fields = [
  'parent',
  'chead',
  'ctail',
  'prev',
  'next',
  'phead',
  'linkTarget',
] as const
const rawFields = ['type'] as const

class Store extends PointerSet<string, typeof fields, typeof rawFields> {
  constructor() {
    super(fields, 256, rawFields)
  }
}

export interface PathWalkerOpts {
  nocase?: boolean
  store?: Store
}

export class PathWalker {
  store: Store
  root: Pointer
  rootPath: string
  cwd: Pointer
  cwdPath: string
  nocase: boolean

  constructor(
    cwd: string = process.cwd(),
    { nocase = defNocase, store = new Store() }: PathWalkerOpts = {}
  ) {
    this.nocase = nocase
    this.store = store
    // resolve and split root, and then add to the store.
    // this is the only time we call path.resolve()
    const cwdPath = resolve(cwd)
    this.cwdPath = cwdPath
    if (isWindows) {
      const rootPath = parse(cwdPath).root
      this.rootPath = unUNCDrive(rootPath)
      if (this.rootPath === sep) {
        const drive = driveCwd(resolve(rootPath))
        this.rootPath = drive + sep
      }
    } else {
      this.rootPath = '/'
    }
    const split = cwdPath.substring(this.rootPath.length).split(sep)
    // resolve('/') leaves '', splits to [''], we don't want that.
    if (split.length === 1 && !split[0]) {
      split.pop()
    }
    // we can safely assume the root is a directory.
    this.root = this.store.alloc(this.rootPath, {}, { type: IFDIR })
    let prev: Pointer = this.root
    for (const part of split) {
      prev = prev
        ? this.child(prev, part)
        : store.alloc(part, { parent: prev }, {})
    }
    this.cwd = prev
  }

  // if path is absolute on a diff root, return
  // new PathWalker(path, this).cwd to store paths in the same store
  //
  // if absolute on the same root, walk from the root
  //
  // otherwise, walk it from this.cwd, and return pointer to result
  resolve(entry: Pointer | string, path?: string): Pointer | undefined {
    if (typeof entry === 'string') {
      path = entry
      entry = this.cwd
    }
    if (!path) {
      return entry
    }
    const rootPath = isWindows
      ? parse(path).root
      : path.startsWith('/')
      ? '/'
      : ''
    const dir = path.substring(rootPath.length)
    const dirParts = dir.split(splitSep)
    if (rootPath) {
      const dir = this.dirname(entry)
      if (!dir) {
        return undefined
      }
      if (!this.sameRoot(rootPath)) {
        const pw = new PathWalker(dir, this)
        return pw.resolveParts(pw.root, dirParts)
      } else {
        return this.resolveParts(this.root, dirParts)
      }
    } else {
      return this.resolveParts(entry, dirParts)
    }
  }

  sameRoot(rootPath: string): boolean {
    if (!isWindows) {
      // only one root, and it's always /
      return true
    }
    rootPath = rootPath
      .replace(/\\/g, '\\')
      .replace(/\\\\\?\\([a-z]:)\\?$/, '$1:\\')
    // windows can (rarely) have case-sensitive filesystem, but
    // UNC and drive letters are always case-insensitive
    if (rootPath.toUpperCase() === this.rootPath.toUpperCase()) {
      return true
    }
    return false
  }

  resolveParts(dir: Pointer, dirParts: string[]): Pointer | undefined {
    let p: Pointer = dir
    for (const part of dirParts) {
      p = this.child(p, part)
      if (!p) {
        return dir
      }
    }
    return p
  }

  child(parent: Pointer, pathPart: string): Pointer {
    if (pathPart === '' || pathPart === '.') {
      return parent
    }
    if (pathPart === '..') {
      return this.parent(parent)
    }
    // find the child
    const chead = this.store.ref(parent, 'chead')
    const ctail = this.store.ref(parent, 'ctail')
    const phead = this.store.ref(parent, 'phead')
    for (let p = chead; p; p = this.store.ref(p, 'next')) {
      const v = this.store.value(p)
      if (this.matchName(v, pathPart)) {
        return p
      }
      if (p === ctail) {
        break
      }
    }

    // didn't find it, create provisional child, since it might not
    // actually exist.  If we know the parent it's a dir, then
    // in fact it CAN'T exist.
    const pchild = this.store.alloc(pathPart, { parent })
    if (this.getType(parent) & ENOCHILD) {
      this.addType(pchild, ENOENT)
    }

    if (phead) {
      // have provisional children already, just append
      this.store.ref(ctail, 'next', pchild)
      this.store.ref(pchild, 'prev', ctail)
      this.store.ref(parent, 'ctail', pchild)
    } else if (ctail) {
      // have children, just not provisional children
      this.store.ref(ctail, 'next', pchild)
      this.store.ref(pchild, 'prev', ctail)
      this.store.refAll(parent, {
        ctail: pchild,
        phead: pchild,
      })
    } else {
      // first child, of any kind
      this.store.refAll(parent, {
        chead: pchild,
        ctail: pchild,
        phead: pchild,
      })
    }
    return pchild
  }

  parent(entry: Pointer): Pointer {
    // parentless entries are root path entries.
    return this.store.ref(entry, 'parent') || entry
  }

  // dirname/basename/fullpath always within a given PW, so we know
  // that the only thing that can be parentless is the root, unless
  // something is deeply wrong.
  basename(entry: Pointer = this.cwd): string | undefined {
    const v = this.store.value(entry)
    return v === undefined ? undefined : v
  }

  fullpath(entry: Pointer = this.cwd): string | undefined {
    const basename = this.basename(entry)
    if (basename === undefined) {
      return undefined
    }
    if (entry === this.root) {
      return basename
    }
    const p = this.store.ref(entry, 'parent')
    if (!p) {
      return undefined
    }
    const pv = this.fullpath(p)
    return pv + (p === this.root ? '' : '/') + basename
  }

  dirname(entry: Pointer = this.cwd): string | void {
    if (entry === this.root) {
      return this.basename(entry)
    }
    const p = this.store.ref(entry, 'parent')
    return p === nullPointer ? undefined : this.fullpath(p)
  }

  calledReaddir(p: Pointer): boolean {
    return (this.getType(p) & READDIR_CALLED) === READDIR_CALLED
  }

  *cachedReaddir(entry: Pointer): Iterable<Pointer> {
    const chead = this.store.ref(entry, 'chead')
    const ctail = this.store.ref(entry, 'ctail')
    const phead = this.store.ref(entry, 'phead')
    while (true) {
      for (
        let c = chead;
        c && c !== phead;
        c = this.store.ref(c, 'next')
      ) {
        yield c
        if (c === ctail) {
          break
        }
      }
      return
    }
  }

  // XXX need a way to do "provisional children", which _might_ exist,
  // but we don't know yet.  So that if you resolve to ('./x/y/z')
  // and then readdir there, we track the path from cwd to x/y/z,
  // without assuming we know ALL the entries.
  // maybe store a flag specifically on the 'type' field?
  // then, when creating a known child here, we can re-use any existing
  // provisional children, so readding the dir in any part of the walk
  // will fill in the provisionals that exist, and mark them as no longer
  // provisional.
  //
  // asynchronous iterator for dir entries
  async *readdir(entry: Pointer = this.cwd): AsyncIterable<Pointer> {
    const t = this.getType(entry)
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
      const dir = await opendir(fullpath)
      for await (const e of dir) {
        yield this.readdirAddChild(entry, e)
      }
      finished = true
    } catch (er) {
      this.readdirFail(entry, er as NodeJS.ErrnoException)
    } finally {
      if (finished) {
        this.readdirSuccess(entry)
      } else {
        // all refs must be considered provisional, since it did not
        // complete.
        this.store.ref(entry, 'phead', this.store.ref(entry, 'chead'))
      }
    }
  }

  readdirSuccess(entry: Pointer) {
    // succeeded, mark readdir called bit
    const type = this.getType(entry)
    this.store.raw(entry, 'type', type | READDIR_CALLED)
    // mark all remaining provisional children as ENOENT
    const phead = this.store.ref(entry, 'phead')
    const ctail = this.store.ref(entry, 'ctail')
    for (let p = phead; p; p = this.store.ref(p, 'next')) {
      this.markENOENT(p)
      if (p === ctail) {
        break
      }
    }
  }

  readdirAddChild(entry: Pointer, e: Dirent) {
    return (
      this.readdirMaybePromoteChild(entry, e) ||
      this.readdirAddNewChild(entry, e)
    )
  }

  readdirMaybePromoteChild(
    entry: Pointer,
    e: Dirent
  ): Pointer | undefined {
    const phead = this.store.ref(entry, 'phead')
    for (let p = phead; p; p = this.store.ref(p, 'next')) {
      const v = this.store.value(p)
      if (!this.matchName(v, e.name)) {
        continue
      }

      return this.readdirPromoteChild(entry, e, p)
    }
  }

  readdirPromoteChild(entry: Pointer, e: Dirent, p: Pointer): Pointer {
    const phead = this.store.ref(entry, 'phead')
    const v = this.store.value(p)
    const type = entToType(e)
    const ctail = this.store.ref(entry, 'ctail')
    const chead = this.store.ref(entry, 'chead')
    this.setType(p, type)
    if (v !== e.name) this.store.value(p, e.name)

    if (p === phead) {
      // just advance phead (potentially off the list)
      this.store.ref(entry, 'phead', this.store.ref(phead, 'next'))
    } else {
      // move to head of list
      const prev = this.store.ref(p, 'prev')
      const next = this.store.ref(p, 'next')

      // if p was at the end of the list, move back tail
      // otherwise, next.prev = prev
      if (p === ctail) this.store.ref(entry, 'ctail', prev)
      else this.store.ref(next, 'prev', prev)

      // prev.next points p's next (possibly null)
      this.store.ref(prev, 'next', next)
      this.store.ref(p, 'next', phead)

      this.store.ref(chead, 'prev', p)
      this.store.ref(p, 'next', chead)
      this.store.ref(entry, 'chead', p)
    }
    return p
  }

  readdirAddNewChild(parent: Pointer, e: Dirent): Pointer {
    // alloc new entry at head, so it's never provisional
    const next = this.store.ref(parent, 'chead')
    const ctail = this.store.ref(parent, 'ctail')
    const type = entToType(e)
    const ref = {
      parent,
      next,
    }
    const child = this.store.alloc(e.name, ref, { type })
    if (next) this.store.ref(next, 'prev', child)
    this.store.ref(parent, 'chead', child)
    if (!ctail) this.store.ref(parent, 'ctail', child)
    return child
  }

  readdirFail(entry: Pointer, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR' || er.code === 'EPERM') {
      this.markENOTDIR(entry)
    }
    if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

  // save the information when we know the entry is not a dir
  markENOTDIR(entry: Pointer) {
    // entry is not a directory, so any children can't exist.
    // unmark IFDIR, mark ENOTDIR
    let t = this.getType(entry)
    // if it's already marked ENOTDIR, bail
    if (t & ENOTDIR) return
    // this could happen if we stat a dir, then delete it,
    // then try to read it or one of its children.
    if ((t & IFDIR) === IFDIR) t &= IFMT_UNKNOWN
    this.setType(entry, t | ENOTDIR)
    this.markChildrenENOENT(entry)
  }

  markENOENT(entry: Pointer) {
    // mark as UNKNOWN and ENOENT
    const t = this.getType(entry)
    if (t & ENOENT) return
    this.setType(entry, (t | ENOENT) & IFMT_UNKNOWN)
    this.markChildrenENOENT(entry)
  }

  markChildrenENOENT(entry: Pointer) {
    const h = this.store.ref(entry, 'chead')
    // all children are provisional
    this.store.ref(entry, 'phead', h)
    const t = this.store.ref(entry, 'ctail')
    // all children do not exist
    for (let p = h; p; p = this.store.ref(p, 'next')) {
      this.markENOENT(p)
      if (p === t) {
        break
      }
    }
  }

  *readdirSync(entry: Pointer = this.cwd): Iterable<Pointer> {
    const t = this.getType(entry)
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
        this.store.ref(entry, 'phead', this.store.ref(entry, 'chead'))
      }
    }
  }

  matchName(a: string | undefined, b: string) {
    const ret =
      a === undefined
        ? false
        : this.nocase
        ? a.toLowerCase() === b.toLowerCase()
        : a === b
    console.error('MN', a, b, ret)
    return ret
  }

  // fills in the data we can gather, or returns undefined on error
  async lstat(entry: Pointer = this.cwd): Promise<Pointer | undefined> {
    const t = this.getType(entry)
    if (t & ENOENT) {
      return
    }
    try {
      const path = this.fullpath(entry)
      if (!path) return
      this.setType(entry, entToType(await lstat(path)))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  lstatSync(entry: Pointer = this.cwd): Pointer | undefined {
    const t = this.getType(entry)
    if (t & ENOENT) {
      return
    }
    try {
      const path = this.fullpath(entry)
      if (!path) return
      this.setType(entry, entToType(lstatSync(path)))
      return entry
    } catch (er) {
      this.lstatFail(entry, er as NodeJS.ErrnoException)
    }
  }

  lstatFail(entry: Pointer, er: NodeJS.ErrnoException) {
    if (er.code === 'ENOTDIR') {
      this.markENOTDIR(this.parent(entry))
    } else if (er.code === 'ENOENT') {
      this.markENOENT(entry)
    }
  }

  cannotReadlink(entry: Pointer): boolean {
    const t = this.getType(entry)
    // cases where it cannot possibly succeed
    return (
      !!((t & IFMT) !== UNKNOWN && !(t & IFLNK)) ||
      !!(t & ENOREADLINK) ||
      !!(t & ENOENT)
    )
  }

  async readlink(entry: Pointer): Promise<Pointer | undefined> {
    const target = this.store.ref(entry, 'linkTarget')
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
      const linkTarget = this.resolve(p, read)
      if (linkTarget) {
        return this.store.ref(entry, 'linkTarget', linkTarget)
      }
    } catch (er) {
      this.readlinkFail(entry, er as NodeJS.ErrnoException)
      return undefined
    }
  }

  readlinkFail(entry: Pointer, er: NodeJS.ErrnoException) {
    let ter: number = ENOREADLINK | (er.code === 'ENOENT' ? ENOENT : 0)
    if (er.code === 'EINVAL') {
      // exists, but not a symlink, we don't know WHAT it is, so remove
      // all IFMT bits.
      ter &= IFMT_UNKNOWN
    }
    if (er.code === 'ENOTDIR') {
      this.markENOTDIR(this.parent(entry))
    }
    this.addType(entry, ter)
  }

  readlinkSync(entry: Pointer): Pointer | undefined {
    const target = this.store.ref(entry, 'linkTarget')
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
      const linkTarget = this.resolve(p, read)
      if (linkTarget) {
        return this.store.ref(entry, 'linkTarget', linkTarget)
      }
    } catch (er) {
      this.readlinkFail(entry, er as NodeJS.ErrnoException)
      return undefined
    }
  }

  // type lookups
  getType(entry: Pointer): number {
    return this.store.raw8(entry, 'type')[0]
  }
  setType(entry: Pointer, type: number): void {
    this.store.raw8(entry, 'type')[0] = type
  }
  addType(entry: Pointer, type: number): void {
    const t = this.store.raw8(entry, 'type')
    t[0] |= type
  }

  isUnknown(entry: Pointer): boolean {
    return (this.getType(entry) && IFMT) === UNKNOWN
  }
  isFile(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFREG
  }
  // a directory, or a symlink to a directory
  isDirectory(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFDIR
  }
  isCharacterDevice(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFCHR
  }
  isBlockDevice(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFBLK
  }
  isFIFO(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFIFO
  }
  isSocket(entry: Pointer): boolean {
    return (this.getType(entry) & IFMT) === IFSOCK
  }

  // we know it is a symlink
  isSymbolicLink(entry: Pointer): boolean {
    return (this.getType(entry) & IFLNK) === IFLNK
  }
}
