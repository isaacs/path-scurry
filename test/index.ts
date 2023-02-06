import * as fs from 'fs'
import { lstatSync, readdirSync, writeFileSync } from 'fs'
import * as fsp from 'fs/promises'
import { basename, resolve } from 'path'
import { rimrafSync } from 'rimraf'
import t from 'tap'
import { normalizePaths } from './fixtures/normalize-paths'

import {
  Path,
  PathBase,
  PathPosix,
  PathWalker,
  PathWalkerDarwin,
  PathWalkerPosix,
  PathWalkerWin32,
  PathWin32,
} from '../'

t.test('platform-specific', t => {
  const { platform, cwd } = process
  const patchCwd = {
    win32: () => {
      return 'c:\\some\\path'
    },
    posix: () => {
      return '/some/path'
    },
  }

  const setPlatform = (value: string = platform) => {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true,
      enumerable: true,
    })
  }

  const setCWD = (value?: string) => {
    if (value === undefined) {
      Object.defineProperty(process, 'cwd', {
        value: cwd,
        configurable: true,
        enumerable: true,
      })
    } else {
      Object.defineProperty(process, 'cwd', {
        value: value === 'win32' ? patchCwd.win32 : patchCwd.posix,
        configurable: true,
        enumerable: true,
      })
    }
  }

  t.test('default (no override)', t => {
    if (platform === 'win32') {
      t.equal(PathWalker, PathWalkerWin32, 'expect windows walker')
      t.equal(Path, PathWin32, 'expect windows path')
    } else if (platform === 'darwin') {
      t.equal(PathWalker, PathWalkerDarwin, 'expect darwin walker')
      t.equal(Path, PathPosix, 'expect posix path')
    } else {
      t.equal(PathWalker, PathWalkerPosix, 'expect posix')
      t.equal(Path, PathPosix, 'expect posix path')
    }
    t.end()
  })

  t.test('force windows', t => {
    t.teardown(() => setPlatform())
    setPlatform('win32')
    const { PathWalker, PathWalkerWin32, Path, PathWin32 } = t.mock(
      '../',
      {}
    )
    t.teardown(() => setCWD())
    setCWD('win32')
    t.equal(PathWalker, PathWalkerWin32, 'expect windows walker')
    t.equal(Path, PathWin32, 'expect windows path')
    const pw = new PathWalker()
    t.equal(pw.nocase, true, 'nocase on PathWalker')
    t.equal(pw.cwd.nocase, true, 'nocase on Path')
    t.equal(pw.resolve(), 'C:\\some\\path')
    t.equal(pw.cwd.fullpath(), 'C:\\some\\path')
    t.equal(pw.cwd.getRoot('\\\\?\\c:\\'), pw.root)
    t.equal(pw.cwd.getRoot('C:\\'), pw.root)
    t.equal(pw.resolve('/'), 'C:\\')
    t.equal(pw.resolve('foo'), 'C:\\some\\path\\foo')
    t.equal(
      pw.resolve('foo', '//x/y/some/absolute/path'),
      '\\\\X\\Y\\some\\absolute\\path'
    )
    t.equal(pw.dirname(pw.root), 'C:\\')
    t.equal(
      pw.resolve('foo', '//?/y:/some/absolute/path'),
      'Y:\\some\\absolute\\path'
    )
    t.equal(
      pw.resolve('d:\\x/y\\z\\a/../', '', '.', './/b'),
      'D:\\x\\y\\z\\b'
    )
    t.equal(pw.cwd.resolve('//?/C:/some/PATH'), pw.cwd)
    t.equal(pw.resolve('//?/D:/X/y\\z\\a/../B'), 'D:\\x\\y\\z\\b')
    t.equal(pw.resolve('//prp1/'), 'C:\\prp1')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    t.equal(new PathWalker('/prp2').cwd.fullpath(), 'C:\\prp2')
    t.equal(new PathWalker('\\prp3').resolve(), 'C:\\prp3')
    t.end()
  })

  t.test('force darwin', t => {
    t.teardown(() => setPlatform())
    setPlatform('darwin')
    const { PathWalker, PathWalkerDarwin, Path, PathPosix } = t.mock(
      '../',
      {}
    )
    t.teardown(() => setCWD())
    setCWD('posix')
    t.equal(PathWalker, PathWalkerDarwin, 'expect darwin walker')
    t.equal(Path, PathPosix, 'expect posix path')
    const pw = new PathWalker()
    t.equal(pw.nocase, true, 'nocase on PathWalker')
    t.equal(pw.cwd.nocase, true, 'nocase on Path')
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.dirname(pw.root), '/')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    t.equal(
      pw.resolve('foo', '//x/y/some/absolute/path'),
      '/x/y/some/absolute/path'
    )
    t.equal(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../FOO'))
    t.end()
  })

  t.test('force posix', t => {
    t.teardown(() => setPlatform())
    setPlatform('posix')
    const { PathWalker, PathWalkerPosix, Path, PathPosix } = t.mock(
      '../',
      {}
    )
    t.teardown(() => setCWD())
    setCWD('posix')
    t.equal(PathWalker, PathWalkerPosix, 'expect posix walker')
    t.equal(Path, PathPosix, 'expect posix path')
    const pw = new PathWalker()
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.nocase, false, 'nocase on PathWalker')
    t.equal(pw.cwd.nocase, false, 'nocase on Path')
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    t.equal(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../foo'))
    t.not(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../FOO'))
    t.end()
  })

  t.end()
})

t.test('readlink', async t => {
  const dir = t.testdir({
    hello: 'world',
    link: t.fixture('symlink', './hello'),
    dirlink: t.fixture('symlink', 'dir'),
    dir: {
      link: t.fixture('symlink', '../hello'),
    },
    another: {
      file: 'f',
    },
  })
  const pw = new PathWalker(dir)
  const wft = { withFileTypes: true }
  t.equal(await pw.readlink('link', wft), pw.cwd.resolve('hello'))
  t.equal(pw.readlinkSync('link', wft), pw.cwd.resolve('hello'))
  t.equal(pw.readlinkSync('dir/link'), resolve(dir, 'hello'))
  t.equal(await pw.readlink('dir/link'), resolve(dir, 'hello'))

  t.equal(pw.readlinkSync('dirlink/link'), resolve(dir, 'hello'))
  t.equal(await pw.readlink('dirlink/link'), resolve(dir, 'hello'))

  // root is never a symlink
  t.equal(await pw.readlink('/'), undefined)
  t.equal(pw.readlinkSync('/'), undefined)

  t.equal(await pw.cwd.resolve('link').readlink(), pw.cwd.resolve('hello'))
  t.equal(
    await pw.cwd.resolve('dir/link').readlink(),
    pw.cwd.resolve('hello')
  )
  t.equal(pw.cwd.resolve('link').readlinkSync(), pw.cwd.resolve('hello'))
  t.equal(
    pw.cwd.resolve('dir/link').readlinkSync(),
    pw.cwd.resolve('hello')
  )

  t.equal(await pw.readlink('hello'), undefined)
  t.equal(pw.readlinkSync('dir'), undefined)
  t.equal(await pw.readlink('e/no/ent'), undefined)
  t.equal(pw.readlinkSync('no/ent/e'), undefined)

  t.equal(await pw.readlink('hello/e/not/dir'), undefined)
  t.equal(pw.readlinkSync('hello/also/not/dir'), undefined)

  // a thing we know is not a symlink
  pw.lstatSync('another/file')
  t.equal(pw.readlinkSync('another/file'), undefined)

  // a nested thing, and then we have to mark its parent as enoent
  t.equal(pw.lstatSync('nope/a/b/c/d/e/f'), undefined)
  t.equal(pw.cwd.resolve('nope').isUnknown(), true)
  t.equal(pw.lstatSync('nope'), undefined)
  t.end()
})

t.test('lstat', async t => {
  const td = t.testdir({
    exists: 'yep',
    notadir: 'ok',
    alsonotdir: 'also ok',
    dir: {},
    link: t.fixture('symlink', 'exists'),
  })
  const pw = new PathWalker(td)
  t.equal(pw.dirname('exists'), resolve(td))
  t.equal(pw.basename(resolve(td) + '/exists'), 'exists')
  t.equal(pw.cwd.resolve('exists').isUnknown(), true)
  t.equal(await pw.lstat('exists'), pw.cwd.resolve('exists'))
  t.equal(pw.lstatSync('exists'), pw.cwd.resolve('exists'))

  t.equal(pw.lstatSync('notadir/notdir'), undefined)
  t.equal(await pw.lstat('alsonotdir/alsonotdir'), undefined)

  t.equal(await pw.lstat('not/existing'), undefined)
  t.equal(pw.lstatSync('not/existing'), undefined)
  t.equal(pw.lstatSync('also/not/existing'), undefined)
  t.equal(await pw.lstat('also/not/existing'), undefined)
  t.equal(pw.cwd.resolve('not/existing')?.isUnknown(), true)

  const file = pw.lstatSync('exists')
  if (file == undefined) throw new Error('expect file')
  t.type(file, Path)
  t.equal(file.isFile(), true)
  t.equal(file.isDirectory(), false)
  t.equal(file.isSymbolicLink(), false)
  t.equal(file.isCharacterDevice(), false)
  t.equal(file.isBlockDevice(), false)
  t.equal(file.isFIFO(), false)
  t.equal(file.isSocket(), false)
  t.equal(file.isUnknown(), false)

  const dir = pw.lstatSync('dir')
  if (!dir) throw new Error('expect dir to exist')
  t.type(dir, Path)
  t.equal(pw.dirname(dir), resolve(td))
  t.equal(pw.basename(dir), 'dir')
  t.equal(dir.isFile(), false)
  t.equal(dir.isDirectory(), true)
  t.equal(dir.isSymbolicLink(), false)
  t.equal(dir.isCharacterDevice(), false)
  t.equal(dir.isBlockDevice(), false)
  t.equal(dir.isFIFO(), false)
  t.equal(dir.isSocket(), false)
  t.equal(dir.isUnknown(), false)

  const link = pw.lstatSync('link')
  if (!link) throw new Error('expect dir to exist')
  t.type(link, Path)
  t.equal(link.isFile(), false)
  t.equal(link.isDirectory(), false)
  t.equal(link.isSymbolicLink(), true)
  t.equal(link.isCharacterDevice(), false)
  t.equal(link.isBlockDevice(), false)
  t.equal(link.isFIFO(), false)
  t.equal(link.isSocket(), false)
  t.equal(link.isUnknown(), false)
})

t.test('readdir, simple basic', async t => {
  const td = t.testdir({
    dir: {
      some: '',
      entries: '',
    },
  })
  const pw = new PathWalker(td)
  t.match(
    new Set(await pw.readdir('dir')),
    new Set([{ name: 'some' }, { name: 'entries' }])
  )
  t.match(
    new Set(await pw.readdir('dir', { withFileTypes: false })),
    new Set(['some', 'entries'])
  )
  t.match(
    new Set(pw.readdirSync('dir', { withFileTypes: false })),
    new Set(['some', 'entries'])
  )
  t.same(pw.readdirSync('.', { withFileTypes: false }), ['dir'])
  t.same(await pw.readdir('', { withFileTypes: false }), ['dir'])
  for (const e of pw.readdirSync('dir')) {
    t.equal(e.isFile(), true)
    t.equal(e.isSymbolicLink(), false)
    t.same(pw.readdirSync(e), [])
    t.same(await pw.readdir(e), [])
  }
  t.same(await pw.readdir('enoent'), [])
  t.same(pw.readdirSync('also/enoent'), [])
})

t.test('readdir with provisionals', async t => {
  const td = t.testdir({
    a: '',
    b: '',
    c: '',
    d: '',
  })

  t.test('one provisional', async t => {
    // play with nocase to show that promotion sets the known name.
    const pw = new PathWalker(td, { nocase: true })
    t.equal(pw.resolve('A'), resolve(td, 'A'))
    t.equal(pw.resolve('a'), resolve(td, 'A'))
    t.equal(pw.cwd.resolve('A').isUnknown(), true)
    t.equal(pw.cwd.resolve('A').isFile(), false)
    t.equal(pw.cwd.resolve('A').name, 'A')
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.equal(pw.cwd.resolve('A').isUnknown(), false)
    t.equal(pw.cwd.resolve('A').isFile(), true)
    t.equal(pw.cwd.resolve('A').name, 'a')

    const pw2 = new PathWalker(td, { nocase: false })
    t.equal(pw2.resolve('A'), resolve(td, 'A'))
    t.not(pw2.resolve('A'), pw2.resolve('a'))
    t.equal(pw2.cwd.resolve('a').isUnknown(), true)
    t.equal(pw2.cwd.resolve('a').isFile(), false)
    t.same(
      new Set(await pw2.readdir('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.equal(pw2.cwd.resolve('a').isUnknown(), false)
    t.equal(pw2.cwd.resolve('a').isFile(), true)
  })

  t.test('two provisional', async t => {
    const pw = new PathWalker(td)
    t.equal(pw.resolve('a'), resolve(td, 'a'))
    t.equal(pw.cwd.resolve('a').isUnknown(), true)
    t.equal(pw.cwd.resolve('a').isFile(), false)
    t.equal(pw.resolve('b'), resolve(td, 'b'))
    t.equal(pw.cwd.resolve('b').isUnknown(), true)
    t.equal(pw.cwd.resolve('b').isFile(), false)
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.equal(pw.cwd.resolve('b').isUnknown(), false)
    t.equal(pw.cwd.resolve('b').isFile(), true)
    const pw2 = new PathWalker(td)
    t.equal(pw2.resolve('a'), resolve(td, 'a'))
    t.equal(pw2.cwd.resolve('a').isUnknown(), true)
    t.equal(pw2.cwd.resolve('a').isFile(), false)
    t.equal(pw2.resolve('b'), resolve(td, 'b'))
    t.equal(pw2.cwd.resolve('b').isUnknown(), true)
    t.equal(pw2.cwd.resolve('b').isFile(), false)
    t.match(pw2.cwd.childrenCache().get(pw2.cwd), {
      length: 2,
      provisional: 0,
    })
    t.same(
      new Set(await pw2.readdir('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.equal(pw2.cwd.resolve('b').isUnknown(), false)
    t.equal(pw2.cwd.resolve('b').isFile(), true)
    t.match(pw2.cwd.childrenCache().get(pw2.cwd), {
      length: 4,
      provisional: 4,
    })
  })

  t.test('four provisional', async t => {
    const pw = new PathWalker(td)
    // do this one in a different order, since some filesystems return sorted
    // readdir() results.
    t.equal(pw.resolve('d'), resolve(td, 'd'))
    t.equal(pw.cwd.resolve('d').isUnknown(), true)
    t.equal(pw.cwd.resolve('d').isFile(), false)
    t.equal(pw.resolve('a'), resolve(td, 'a'))
    t.equal(pw.cwd.resolve('a').isUnknown(), true)
    t.equal(pw.cwd.resolve('a').isFile(), false)
    t.equal(pw.resolve('c'), resolve(td, 'c'))
    t.equal(pw.cwd.resolve('c').isUnknown(), true)
    t.equal(pw.cwd.resolve('c').isFile(), false)
    t.equal(pw.resolve('b'), resolve(td, 'b'))
    t.equal(pw.cwd.resolve('b').isUnknown(), true)
    t.equal(pw.cwd.resolve('b').isFile(), false)
    t.match(pw.cwd.childrenCache().get(pw.cwd), {
      length: 4,
      provisional: 0,
    })
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.match(pw.cwd.childrenCache().get(pw.cwd), {
      length: 4,
      provisional: 4,
    })

    const pw2 = new PathWalker(td)
    t.equal(pw2.resolve('d'), resolve(td, 'd'))
    t.equal(pw2.cwd.resolve('d').isUnknown(), true)
    t.equal(pw2.cwd.resolve('d').isFile(), false)
    t.equal(pw2.resolve('a'), resolve(td, 'a'))
    t.equal(pw2.cwd.resolve('a').isUnknown(), true)
    t.equal(pw2.cwd.resolve('a').isFile(), false)
    t.equal(pw2.resolve('c'), resolve(td, 'c'))
    t.equal(pw2.cwd.resolve('c').isUnknown(), true)
    t.equal(pw2.cwd.resolve('c').isFile(), false)
    t.equal(pw2.resolve('b'), resolve(td, 'b'))
    t.equal(pw2.cwd.resolve('b').isUnknown(), true)
    t.equal(pw2.cwd.resolve('b').isFile(), false)
    t.match(pw2.cwd.childrenCache().get(pw2.cwd), {
      length: 4,
      provisional: 0,
    })
    t.same(
      new Set(await pw2.readdir('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd'])
    )
    t.equal(pw2.cwd.resolve('b').isUnknown(), false)
    t.equal(pw2.cwd.resolve('b').isFile(), true)
    t.match(pw2.cwd.childrenCache().get(pw2.cwd), {
      length: 4,
      provisional: 4,
    })
  })

  t.test('get children, then fail readdir', async t => {
    t.test('sync', async t => {
      // give this one not nocase to test the promotion comparison branch
      const pw = new PathWalker(t.testdir({ dir: { a: '', b: '' } }), {
        nocase: false,
      })
      pw.resolve('dir', 'a/b')
      pw.resolve('dir', 'a/c')
      const children = pw.cwd.childrenCache().get(pw.cwd.resolve('dir/a'))
      if (!children) throw new Error('no children')
      t.match(children, { length: 2, provisional: 0 })
      // just pretend we learned one was real
      //@ts-ignore
      children.provisional++
      t.match(children, { length: 2, provisional: 1 })
      t.same(pw.readdirSync('dir/a'), [])
      // nope, now they're all provisional again
      t.match(children, { length: 2, provisional: 0 })
    })
    t.test('async', async t => {
      // give this one nocase to test the promotion comparison branch
      const pw = new PathWalker(t.testdir({ dir: { a: '', b: '' } }), {
        nocase: true,
      })
      pw.resolve('dir', 'a/B')
      pw.resolve('dir', 'a/C')
      const children = pw.cwd.childrenCache().get(pw.cwd.resolve('dir/a'))
      if (!children) throw new Error('no children')
      t.match(children, { length: 2, provisional: 0 })
      // just pretend we learned one was real
      //@ts-ignore
      children.provisional++
      t.match(children, { length: 2, provisional: 1 })
      t.same(await pw.readdir('dir/a'), [])
      // nope, now they're all provisional again
      t.match(children, { length: 2, provisional: 0 })
    })
  })

  t.test('provisional, known existing, then not', async t => {
    const td = t.testdir({
      a: '',
      b: { c: '' },
      d: { e: '' },
    })
    const pw = new PathWalker(td)
    t.equal(pw.lstatSync('b/c')?.isFile(), true)
    rimrafSync(td + '/b')
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'd'])
    )
    t.match(pw.cwd.childrenCache().get(pw.cwd), {
      length: 3,
      provisional: 2,
    })
    t.equal(pw.lstatSync('b/c'), undefined)
    t.equal(pw.lstatSync('b'), undefined)
    t.equal(pw.cwd.resolve('b/c').isUnknown(), true)
    const d = pw.cwd.resolve('b/c/d/e')
    t.equal(d.isUnknown(), true)
    t.equal(d.lstatSync(), undefined)
  })

  t.test('known dir, then delete it, then read it', async t => {
    const td = t.testdir({ a: { b: '' } })
    const pw = new PathWalker(td)
    t.equal(pw.lstatSync('a')?.isDirectory(), true)
    t.equal(pw.lstatSync('a/b')?.isFile(), true)
    t.equal(pw.cwd.resolve('a').isDirectory(), true)
    t.equal(pw.cwd.resolve('a/b').isFile(), true)
    rimrafSync(td + '/a')
    writeFileSync(td + '/a', '')
    t.same(pw.readdirSync('a'), [])
    t.equal(pw.cwd.resolve('a').isDirectory(), false)
    t.equal(pw.cwd.resolve('a/b').isFile(), false)
    t.equal(pw.cwd.resolve('a').isUnknown(), true)
    t.equal(pw.cwd.resolve('a/b').isUnknown(), true)
    // re-trigger a ENOTDIR for coverage
    t.equal(pw.lstatSync('a/c'), undefined)
  })
})

t.test('all the IFMTs!', async t => {
  const no = () => false
  const yes = () => true

  const base = {
    isFile: no,
    isDirectory: no,
    isSymbolicLink: no,
    isCharacterDevice: no,
    isBlockDevice: no,
    isSocket: no,
    isFIFO: no,
    isUnknown: no,
  }

  const onlyOne = (
    t: Tap.Test,
    e: Path & { [k in keyof typeof base]: () => boolean },
    pass: string = ''
  ) => {
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      t.equal(e[k](), k === pass, `${e.name} ${k} ${k === pass}`)
    }
  }

  const fakeStat = (f: string) => {
    const b = basename(f)
    switch (b) {
      case 'file':
        return { ...base, name: b, isFile: yes }
      case 'dir':
        return { ...base, name: b, isDirectory: yes }
      case 'link':
        return { ...base, name: b, isSymbolicLink: yes }
      case 'chr':
        return { ...base, name: b, isCharacterDevice: yes }
      case 'blk':
        return { ...base, name: b, isBlockDevice: yes }
      case 'sock':
        return { ...base, name: b, isSocket: yes }
      case 'fifo':
        return { ...base, name: b, isFIFO: yes }
      case 'nope':
        return { ...base, name: b }
      default:
        return { ...lstatSync(f), name: b }
    }
  }

  const fakeReaddir = (p: string) => {
    const entries = readdirSync(p)
    return entries.map(e => fakeStat(resolve(p, e)))
  }

  const td = t.testdir({
    file: 'file',
    dir: 'dir',
    link: 'link',
    chr: 'chr',
    blk: 'blk',
    sock: 'sock',
    fifo: 'fifo',
    nope: 'nope',
  })

  const mockFsPromises = {
    ...fsp,
    lstat: async (f: string) => fakeStat(f),
    readdir: async (p: string) => fakeReaddir(p),
  }

  const mockFs = {
    ...fs,
    lstatSync: fakeStat,
    readdirSync: fakeReaddir,
    promises: mockFsPromises,
  }

  const { PathWalker } = t.mock('../', {
    fs: mockFs,
    'fs/promises': mockFsPromises,
  })

  const entries = new PathWalker(td).readdirSync()
  for (const e of entries) {
    const b = e.name
    switch (b) {
      case 'file':
        onlyOne(t, e, 'isFile')
        continue
      case 'dir':
        onlyOne(t, e, 'isDirectory')
        continue
      case 'link':
        onlyOne(t, e, 'isSymbolicLink')
        continue
      case 'chr':
        onlyOne(t, e, 'isCharacterDevice')
        continue
      case 'blk':
        onlyOne(t, e, 'isBlockDevice')
        continue
      case 'sock':
        onlyOne(t, e, 'isSocket')
        continue
      case 'fifo':
        onlyOne(t, e, 'isFIFO')
        continue
      case 'nope':
        onlyOne(t, e, 'isUnknown')
        continue
      default:
        onlyOne(t, e, 'should not be here')
        continue
    }
  }
})

t.test('walking', async t => {
  t.formatSnapshot = normalizePaths
  const td = t.testdir({
    a: {
      b: {
        c: {
          d: {
            e: '',
            f: '',
            g: '',
            link: t.fixture('symlink', '../../..'),
          },
        },
        d: {
          e: '',
          f: '',
          g: '',
          link: t.fixture('symlink', '../..'),
        },
      },
    },
  })
  for (const follow of [false, undefined, true]) {
    for (const reuse of [false, true]) {
      t.test(`basic walks, follow=${follow}, reuse=${reuse}`, async t => {
        let pw = new PathWalker(td)
        // if not following, then just take the default args when we
        // walk to get the entries, to cover that code path.
        const syncWalk = follow
          ? pw.walkSync('', { follow })
          : pw.walkSync()
        const entries = new Set<PathBase>()
        const paths = new Set<string>()

        const verifyEntry = (e: Path) => {
          if (!(e instanceof Path)) {
            throw new Error('expected Path object')
          }
          if (reuse) {
            // same exact entry found.
            if (!entries.has(e)) {
              throw new Error('not found in set: ' + e.fullpath())
            }
          } else {
            // some matching entry found
            for (const entry of entries) {
              if (entry.fullpath() === e.fullpath()) {
                return
              }
            }
            throw new Error('not found in set: ' + e.fullpath())
          }
        }
        const verifyPath = (p: string) => {
          if (typeof p !== 'string') {
            throw new Error('expected string path')
          }
          if (!paths.has(p)) {
            throw new Error('not found in set: ' + p)
          }
        }

        t.test('initial walk, sync', async t => {
          for (const e of syncWalk) {
            t.type(e, Path)
            entries.add(e)
            paths.add(e.fullpath())
          }
        })

        const withFileTypes = false
        t.test('second walkSync, strings', async t => {
          if (!reuse) pw = new PathWalker(td)
          let count = 0
          for (const path of pw.walkSync('', { follow, withFileTypes })) {
            verifyPath(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)
        })

        t.test('async walk', async t => {
          if (!reuse) pw = new PathWalker(td)
          const w = follow ? pw.walk('', { follow }) : pw.walk()
          let count = 0
          for (const path of await w) {
            verifyEntry(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }

          count = 0
          if (!reuse) pw = new PathWalker(td)
          for (const path of await pw.walk('', {
            follow,
            withFileTypes,
          })) {
            verifyPath(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)
        })

        if (!follow) {
          // default iterators never follow
          t.test('for [await] of', async t => {
            if (!reuse) pw = new PathWalker(td)
            let count = 0
            for (const path of pw) {
              verifyEntry(path)
              count++
              if (count > entries.size) {
                throw new Error(
                  `too many entries, ${count} > ${entries.size}`
                )
              }
            }
            t.equal(count, entries.size)

            count = 0
            if (!reuse) pw = new PathWalker(td)
            for await (const path of pw) {
              verifyEntry(path)
              count++
              if (count > entries.size) {
                throw new Error(
                  `too many entries, ${count} > ${entries.size}`
                )
              }
            }
            t.equal(count, entries.size)
          })
        }

        t.test('iterateSync', async t => {
          if (!reuse) pw = new PathWalker(td)
          const f = follow
            ? pw.iterateSync('', { follow })
            : pw.iterateSync()
          let count = 0
          for (const path of f) {
            verifyEntry(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)

          if (!reuse) pw = new PathWalker(td)
          count = 0
          for (const path of pw.iterateSync('', {
            follow,
            withFileTypes,
          })) {
            verifyPath(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)
        })

        t.test('async iterate', async t => {
          if (!reuse) pw = new PathWalker(td)
          const f = follow ? pw.iterate('', { follow }) : pw.iterate()
          let count = 0
          for await (const path of f) {
            verifyEntry(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)

          count = 0
          if (!reuse) pw = new PathWalker(td)
          for await (const path of pw.iterate('', {
            follow,
            withFileTypes,
          })) {
            verifyPath(path)
            count++
            if (count > entries.size) {
              throw new Error(
                `too many entries, ${count} > ${entries.size}`
              )
            }
          }
          t.equal(count, entries.size)
        })
      })
    }
  }
})
