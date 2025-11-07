import * as fs from 'fs'
import { lstatSync, readdirSync, writeFileSync, Stats } from 'fs'
import * as fsp from 'fs/promises'
import { lstat } from 'fs/promises'
import { basename, relative, resolve } from 'path'
import { rimrafSync } from 'rimraf'
import t, { Test } from 'tap'
import { pathToFileURL } from 'url'
import { normalizePaths } from './fixtures/normalize-paths.js'

import {
  FSOption,
  Path,
  PathBase,
  PathPosix,
  PathScurry,
  PathScurryDarwin,
  PathScurryPosix,
  PathScurryWin32,
  PathWin32,
  WalkOptions,
} from '../dist/esm/index.js'

t.formatSnapshot = (o: any) =>
  normalizePaths(o, { [process.cwd()]: '{CWD}' })

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
      t.equal(PathScurry, PathScurryWin32, 'expect windows Scurry')
      t.equal(Path, PathWin32, 'expect windows path')
    } else if (platform === 'darwin') {
      t.equal(PathScurry, PathScurryDarwin, 'expect darwin Scurry')
      t.equal(Path, PathPosix, 'expect posix path')
    } else {
      t.equal(PathScurry, PathScurryPosix, 'expect posix')
      t.equal(Path, PathPosix, 'expect posix path')
    }
    t.end()
  })

  t.test('force windows', async t => {
    t.teardown(() => setPlatform())
    setPlatform('win32')
    const { PathScurry, PathScurryWin32, Path, PathWin32 } =
      await t.mockImport<typeof import('../dist/esm/index.js')>(
        '../dist/esm/index.js',
        {},
      )
    t.teardown(() => setCWD())
    setCWD('win32')
    t.equal(PathScurry, PathScurryWin32, 'expect windows Scurry')
    t.equal(Path, PathWin32, 'expect windows path')
    const pw = new PathScurry()
    t.equal(pw.nocase, true, 'nocase on PathScurry')
    t.equal(pw.cwd.nocase, true, 'nocase on Path')
    t.equal(pw.resolve(), 'C:\\some\\path')
    t.equal(pw.resolvePosix(), '//?/C:/some/path')
    t.equal(pw.relative('c:/some/path/a/b'), 'a\\b')
    t.equal(pw.relative('c:/some/a/b'), '..\\a\\b')
    t.equal(pw.relative('/a/b'), 'C:\\a\\b')
    t.equal(pw.relativePosix('c:/some/path/a/b'), 'a/b')
    t.equal(pw.relativePosix('c:/some/a/b'), '../a/b')
    t.equal(pw.relativePosix('/a/b'), '//?/C:/a/b')
    t.equal(pw.cwd.fullpath(), 'C:\\some\\path')
    t.equal(pw.cwd.parentPath, pw.cwd.parent?.fullpath())
    t.equal(pw.cwd.root.parentPath, pw.cwd.root.fullpath())
    t.equal(pw.cwd.fullpathPosix(), '//?/C:/some/path')
    t.equal(pw.cwd.getRoot('\\\\?\\c:\\'), pw.root)
    t.equal(pw.cwd.getRoot('C:\\'), pw.root)
    t.equal(pw.resolve('/'), 'C:\\')
    t.equal(pw.resolvePosix('/'), '//?/C:/')
    t.equal(pw.resolve('foo'), 'C:\\some\\path\\foo')
    t.equal(pw.resolvePosix('foo'), '//?/C:/some/path/foo')
    t.equal(
      pw.resolve('foo', '//x/y/some/absolute/path'),
      '\\\\X\\Y\\some\\absolute\\path',
    )
    t.equal(
      pw.resolvePosix('foo', '//x/y/some/absolute/path'),
      '//X/Y/some/absolute/path',
    )
    t.equal(pw.dirname(pw.root), 'C:\\')
    t.equal(
      pw.resolve('foo', '//?/y:/some/absolute/path'),
      'Y:\\some\\absolute\\path',
    )
    t.equal(
      pw.resolvePosix('foo', '//?/y:/some/absolute/path'),
      '//?/Y:/some/absolute/path',
    )
    t.equal(
      pw.resolve('d:\\x/y\\z\\a/../', '', '.', './/b'),
      'D:\\x\\y\\z\\b',
    )
    t.equal(
      pw.resolvePosix('d:\\x/y\\z\\a/../', '', '.', './/b'),
      '//?/D:/x/y/z/b',
    )
    t.equal(pw.cwd.resolve('//?/C:/some/PATH'), pw.cwd)
    t.equal(pw.resolve('//?/D:/X/y\\z\\a/../B'), 'D:\\x\\y\\z\\b')
    t.equal(pw.resolvePosix('//?/D:/X/y\\z\\a/../B'), '//?/D:/x/y/z/b')
    t.equal(pw.resolve('//prp1/'), 'C:\\prp1')
    t.equal(pw.resolvePosix('//prp1/'), '//?/C:/prp1')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    pw.chdir(pw.root)
    t.equal(pw.relativePosix('C:/some'), 'some')
    t.equal(pw.relative('C:/some/PATH'), 'some\\path')
    t.equal(pw.relativePosix('C:/some/PATH'), 'some/path')
    t.equal(new PathScurry('/prp2').cwd.fullpath(), 'C:\\prp2')
    t.equal(new PathScurry('\\prp3').resolve(), 'C:\\prp3')
    t.equal(new PathScurry('\\prp3').resolvePosix(), '//?/C:/prp3')
    t.end()
  })

  t.test('force darwin', async t => {
    t.teardown(() => setPlatform())
    setPlatform('darwin')
    const { PathScurry, PathScurryDarwin, Path, PathPosix } =
      await t.mockImport<typeof import('../dist/esm/index.js')>(
        '../dist/esm/index.js',
        {},
      )
    t.teardown(() => setCWD())
    setCWD('posix')
    t.equal(PathScurry, PathScurryDarwin, 'expect darwin Scurry')
    t.equal(Path, PathPosix, 'expect posix path')
    const pw = new PathScurry()
    t.equal(pw.nocase, true, 'nocase on PathScurry')
    t.equal(pw.cwd.nocase, true, 'nocase on Path')
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.cwd.fullpathPosix(), '/some/path')
    t.equal(pw.relative('/some/path/a/b'), 'a/b')
    t.equal(pw.relative('/some/a/b'), '../a/b')
    t.equal(pw.relative('/a/b'), '/a/b')
    t.equal(pw.relativePosix('/some/path/a/b'), 'a/b')
    t.equal(pw.relativePosix('/some/a/b'), '../a/b')
    t.equal(pw.relativePosix('/a/b'), '/a/b')
    t.equal(pw.dirname(pw.root), '/')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.resolvePosix('foo'), '/some/path/foo')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    t.equal(
      pw.resolve('foo', '//x/y/some/absolute/path'),
      '/x/y/some/absolute/path',
    )
    t.equal(
      pw.resolvePosix('foo', '//x/y/some/absolute/path'),
      '/x/y/some/absolute/path',
    )
    t.equal(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../FOO'))
    pw.chdir(pw.root)
    t.equal(pw.relativePosix('/some'), 'some')
    t.equal(pw.relative('/some/PATH'), 'some/path')
    t.equal(pw.relativePosix('/some/PATH'), 'some/path')
    t.end()
  })

  t.test('force posix', async t => {
    t.teardown(() => setPlatform())
    setPlatform('posix')
    const { PathScurry, PathScurryPosix, Path, PathPosix } =
      await t.mockImport<typeof import('../dist/esm/index.js')>(
        '../dist/esm/index.js',
        {},
      )
    t.teardown(() => setCWD())
    setCWD('posix')
    t.equal(PathScurry, PathScurryPosix, 'expect posix Scurry')
    t.equal(Path, PathPosix, 'expect posix path')
    const pw = new PathScurry()
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.resolvePosix('foo'), '/some/path/foo')
    t.equal(pw.nocase, false, 'nocase on PathScurry')
    t.equal(pw.cwd.nocase, false, 'nocase on Path')
    t.equal(pw.cwd.fullpath(), '/some/path')
    t.equal(pw.resolve('foo'), '/some/path/foo')
    t.equal(pw.resolvePosix('foo'), '/some/path/foo')
    t.equal(pw.cwd.resolve('../../../../../../../'), pw.root)
    t.equal(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../foo'))
    t.not(pw.cwd.resolve('foo'), pw.cwd.resolve('x/../FOO'))
    pw.chdir(pw.root)
    t.equal(pw.relativePosix('/some'), 'some')
    t.equal(pw.relative('/some/PATH'), 'some/PATH')
    t.equal(pw.relativePosix('/some/PATH'), 'some/PATH')
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
  const pw = new PathScurry(dir)
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

  // calling without a path reads cwd
  const onLink = new PathScurry(dir + '/dir/link')
  const withFileTypes = true
  t.equal(await onLink.readlink(), resolve(dir, 'hello'))
  t.equal(
    onLink.readlinkSync({ withFileTypes })?.fullpath(),
    resolve(dir, 'hello'),
  )
  t.equal(
    (await onLink.readlink({ withFileTypes }))?.fullpath(),
    resolve(dir, 'hello'),
  )

  t.equal(await pw.cwd.resolve('link').readlink(), pw.cwd.resolve('hello'))
  t.equal(
    await pw.cwd.resolve('dir/link').readlink(),
    pw.cwd.resolve('hello'),
  )
  t.equal(pw.cwd.resolve('link').readlinkSync(), pw.cwd.resolve('hello'))
  t.equal(
    pw.cwd.resolve('dir/link').readlinkSync(),
    pw.cwd.resolve('hello'),
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
  t.equal(pw.cwd.resolve('nope/a/b/c/d/e/f').isENOENT(), true)
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
  const pw = new PathScurry(td)
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
  t.equal(pw.cwd.resolve('not/existing')?.getType(), 'Unknown')

  const file = pw.lstatSync('exists')
  if (file == undefined) throw new Error('expect file')
  t.type(file, Path)
  t.equal(file.isFile(), true)
  t.equal(file.getType(), 'File')
  t.equal(file.isType('File'), true)
  t.equal(file.isType('Directory'), false)
  t.equal(file.isType('Socket'), false)
  t.equal(file.isDirectory(), false)
  t.equal(file.isSymbolicLink(), false)
  t.equal(file.isCharacterDevice(), false)
  t.equal(file.isBlockDevice(), false)
  t.equal(file.isFIFO(), false)
  t.equal(file.isSocket(), false)
  t.equal(file.isType('Unknown'), false)

  const dir = pw.lstatSync('dir')
  if (!dir) throw new Error('expect dir to exist')
  t.type(dir, Path)
  t.equal(pw.dirname(dir), resolve(td))
  t.equal(pw.basename(dir), 'dir')
  t.equal(dir.isFile(), false)
  t.equal(dir.isDirectory(), true)
  t.equal(dir.getType(), 'Directory')
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
  t.equal(link.getType(), 'SymbolicLink')
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
    link: t.fixture('symlink', 'dir/some'),
    file1: '1',
    file2: '2',
  })
  const pw = new PathScurry(td)
  t.match(
    new Set(await pw.readdir('dir')),
    new Set([{ name: 'some' }, { name: 'entries' }]),
  )
  // gut check
  t.same(
    [
      pw.cwd.resolve('dir/some').isFile(),
      pw.cwd.resolve('dir/entries').isFile(),
    ],
    [true, true],
  )

  t.match(
    new Set(await pw.readdir('dir', { withFileTypes: false })),
    new Set(['some', 'entries']),
  )
  t.match(
    new Set(pw.readdirSync('dir', { withFileTypes: false })),
    new Set(['some', 'entries']),
  )
  t.same(
    new Set(pw.readdirSync('.', { withFileTypes: false })),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(
    new Set(await pw.readdir('', { withFileTypes: false })),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(
    new Set(pw.readdirSync({ withFileTypes: false })),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(
    new Set(await pw.readdir({ withFileTypes: false })),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(
    new Set(pw.readdirSync().map(e => e.name)),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(
    new Set((await pw.readdir()).map(e => e.name)),
    new Set(['dir', 'link', 'file1', 'file2']),
  )
  t.same(pw.cwd.resolve('link').readdirSync(), [])
  t.same(pw.cwd.resolve('file1').readdirSync(), [])
  t.same(await pw.cwd.resolve('file2').readdir(), [])

  for (const e of pw.readdirSync('dir')) {
    t.equal(e.isFile(), true)
    t.equal(e.isSymbolicLink(), false)
    t.same(pw.readdirSync(e), [])
    t.same(await pw.readdir(e), [])
  }

  t.same(await pw.readdir('enoent'), [])
  t.same(pw.readdirSync('also/enoent'), [])
  t.test('readdirCB', async t => {
    t.test('cached, basic', t => {
      const dir = pw.cwd.resolve('dir')
      let sync = true
      dir.readdirCB((er, entries) => {
        t.equal(er, null)
        t.match(
          new Set(entries),
          new Set([{ name: 'some' }, { name: 'entries' }]),
        )
        t.equal(sync, false, 'did not call cb synchronously')
        t.end()
      })
      sync = false
    })
    t.test('cached, zalgo', t => {
      const dir = pw.cwd.resolve('dir')
      let sync = true
      dir.readdirCB((er, entries) => {
        t.equal(er, null)
        t.match(
          new Set(entries),
          new Set([{ name: 'some' }, { name: 'entries' }]),
        )
        t.equal(sync, true, 'called cb synchronously')
        t.end()
      }, true)
      sync = false
    })
    t.test('file', t => {
      let sync = true
      pw.cwd.resolve('dir/some').readdirCB((er, entries) => {
        t.equal(er, null)
        t.same(entries, [])
        t.equal(sync, false)
        t.end()
      })
      sync = false
    })
    t.test('file, zalgo', t => {
      let sync = true
      pw.cwd.resolve('dir/some').readdirCB((er, entries) => {
        t.equal(er, null)
        t.same(entries, [])
        t.equal(sync, true)
        t.end()
      }, true)
      sync = false
    })
    t.test('noent', t => {
      let sync = true
      pw.cwd.resolve('noent').readdirCB((er, entries) => {
        t.equal(er, null)
        t.equal(sync, false)
        t.same(entries, [])
        t.end()
      })
      sync = false
    })
    t.test('noent again (cached failure)', t => {
      let sync = true
      pw.cwd.resolve('noent').readdirCB((er, entries) => {
        t.equal(er, null)
        t.equal(sync, false)
        t.same(entries, [])
        t.end()
      })
      sync = false
    })
    t.test('noent again, zalgo (cached failure)', t => {
      let sync = true
      pw.cwd.resolve('noent').readdirCB((er, entries) => {
        t.equal(er, null)
        t.equal(sync, true)
        t.same(entries, [])
        t.end()
      }, true)
      sync = false
    })
  })
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
    const pw = new PathScurry(td, { nocase: true })
    t.equal(pw.resolve('A'), resolve(td, 'A'))
    t.equal(pw.resolve('a'), resolve(td, 'A'))
    t.equal(pw.cwd.resolve('A').isUnknown(), true)
    t.equal(pw.cwd.resolve('A').isFile(), false)
    t.equal(pw.cwd.resolve('A').name, 'A')
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd']),
    )
    t.equal(pw.cwd.resolve('A').isUnknown(), false)
    t.equal(pw.cwd.resolve('A').isFile(), true)
    t.equal(pw.cwd.resolve('A').name, 'a')

    const pw2 = new PathScurry(td, { nocase: false })
    t.equal(pw2.resolve('A'), resolve(td, 'A'))
    t.not(pw2.resolve('A'), pw2.resolve('a'))
    t.equal(pw2.cwd.resolve('a').isUnknown(), true)
    t.equal(pw2.cwd.resolve('a').isFile(), false)
    t.same(
      new Set(await pw2.readdir('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd']),
    )
    t.equal(pw2.cwd.resolve('a').isUnknown(), false)
    t.equal(pw2.cwd.resolve('a').isFile(), true)
  })

  t.test('two provisional', async t => {
    const pw = new PathScurry(td)
    t.equal(pw.resolve('a'), resolve(td, 'a'))
    t.equal(pw.cwd.resolve('a').isUnknown(), true)
    t.equal(pw.cwd.resolve('a').isFile(), false)
    t.equal(pw.resolve('b'), resolve(td, 'b'))
    t.equal(pw.cwd.resolve('b').isUnknown(), true)
    t.equal(pw.cwd.resolve('b').isFile(), false)
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'b', 'c', 'd']),
    )
    t.equal(pw.cwd.resolve('b').isUnknown(), false)
    t.equal(pw.cwd.resolve('b').isFile(), true)
    const pw2 = new PathScurry(td)
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
      new Set(['a', 'b', 'c', 'd']),
    )
    t.equal(pw2.cwd.resolve('b').isUnknown(), false)
    t.equal(pw2.cwd.resolve('b').isFile(), true)
    t.match(pw2.cwd.childrenCache().get(pw2.cwd), {
      length: 4,
      provisional: 4,
    })
  })

  t.test('four provisional', async t => {
    const pw = new PathScurry(td)
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
      new Set(['a', 'b', 'c', 'd']),
    )
    t.match(pw.cwd.childrenCache().get(pw.cwd), {
      length: 4,
      provisional: 4,
    })

    const pw2 = new PathScurry(td)
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
      new Set(['a', 'b', 'c', 'd']),
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
      const pw = new PathScurry(t.testdir({ dir: { a: '', b: '' } }), {
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
      const pw = new PathScurry(t.testdir({ dir: { a: '', b: '' } }), {
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
    const pw = new PathScurry(td)
    t.equal(pw.lstatSync('b/c')?.isFile(), true)
    rimrafSync(td + '/b')
    t.same(
      new Set(pw.readdirSync('', { withFileTypes: false })),
      new Set(['a', 'd']),
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
    const pw = new PathScurry(td)
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
    t: Test,
    e: Path & { [k in keyof typeof base]: () => boolean },
    pass: string = '',
  ) => {
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      t.equal(e[k](), k === pass, `${e.name} ${k} ${k === pass}`)
    }
    t.equal(e.getType(), pass.replace(/^is/, ''), `${e.name} getType()`)
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
  const canReaddir = {
    // of course dirs are worth a shot
    dir: true,
    // might be a symlink to a directory
    link: true,
    // unknown, worth trying to read it
    nope: true,

    file: false,
    chr: false,
    blk: false,
    sock: false,
    fifo: false,
  }

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

  const { PathScurry } = await t.mockImport<
    typeof import('../dist/esm/index.js')
  >('../dist/esm/index.js', {
    fs: mockFs,
    'fs/promises': mockFsPromises,
  })

  const pw = new PathScurry(td)
  t.equal(pw.cwd.resolve('noent').canReaddir(), true)
  t.equal(pw.cwd.resolve('file').lstatSync()?.canReaddir(), false)
  const entries = pw.readdirSync()
  for (const e of entries) {
    const b = e.name as keyof typeof canReaddir
    t.equal(e.canReaddir(), canReaddir[b], `${b}.canReaddir`)
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

t.test('weird readdir failure', async t => {
  // this test is just here for coverage, we return [] for
  // ALL errors, even those we don't know about.
  const mockFs = {
    ...fs,
    readdirSync: () => {
      throw Object.assign(new Error('wat'), { code: 'wat' })
    },
  }
  const { PathScurry } = await t.mockImport<
    typeof import('../dist/esm/index.js')
  >('../dist/esm/index.js', { fs: mockFs })
  const pw = new PathScurry(t.testdir({ a: '' }))
  const a = pw.cwd.resolve('a').lstatSync()
  t.equal(a?.isFile(), true)
  t.same(pw.readdirSync(), [])
  t.equal(a?.isFile(), true)
  t.same(pw.cwd.children(), [a])
  t.match(pw.cwd.children(), { provisional: 0 })
})

t.test('eloop', async t => {
  const td = t.testdir({
    // ELOOP spin in place
    pivot: t.fixture('symlink', './pivot'),
    // what it says on the tin
    enoent: t.fixture('symlink', 'no thing here'),
    // a/b/c/d/e/f/g/dest
    dest: t.fixture('symlink', './a/travel/dest'),
    // a/b/c/d/e/f/g/round -> ... -> home
    roundtrip: t.fixture('symlink', './a/travel/round'),
    home: 'welcome back',
    // ELOOPs through all the dirs
    bigloop: t.fixture('symlink', 'a/down'),
    aa: t.fixture('symlink', 'a'),
    a: {
      up: t.fixture('symlink', 'peak'),
      peak: t.fixture('symlink', 'down'),
      down: t.fixture('symlink', 'b/down'),
      travel: t.fixture('symlink', './b/travel'),
      round: t.fixture('symlink', '../home'),
      bb: t.fixture('symlink', 'b'),
      b: {
        down: t.fixture('symlink', 'c/down'),
        up: t.fixture('symlink', '../up'),
        travel: t.fixture('symlink', './c/travel'),
        round: t.fixture('symlink', '../round'),
        cc: t.fixture('symlink', 'c'),
        c: {
          down: t.fixture('symlink', 'd/down'),
          up: t.fixture('symlink', '../up'),
          travel: t.fixture('symlink', './d/travel'),
          round: t.fixture('symlink', '../round'),
          dd: t.fixture('symlink', 'd'),
          d: {
            down: t.fixture('symlink', 'e/down'),
            up: t.fixture('symlink', '../up'),
            travel: t.fixture('symlink', './e/travel'),
            round: t.fixture('symlink', '../round'),
            ee: t.fixture('symlink', 'e'),
            e: {
              down: t.fixture('symlink', 'f/down'),
              up: t.fixture('symlink', '../up'),
              travel: t.fixture('symlink', './f/travel'),
              round: t.fixture('symlink', '../round'),
              ff: t.fixture('symlink', 'f'),
              f: {
                down: t.fixture('symlink', 'g/down'),
                up: t.fixture('symlink', '../up'),
                travel: t.fixture('symlink', './g'),
                round: t.fixture('symlink', '../round'),
                gg: t.fixture('symlink', 'g'),
                g: {
                  down: t.fixture('symlink', 'bounce'),
                  bounce: t.fixture('symlink', 'up'),
                  up: t.fixture('symlink', '../up'),
                  round: t.fixture('symlink', '../round'),
                  dest: 'you have arrived',
                },
              },
            },
          },
        },
      },
    },
  })

  const paths = [
    'pivot',
    'enoent',
    'dest',
    'roundtrip',
    'bigloop',
    'aa/b/cc/d/ee/f/gg',
    'a/bb/c/dd/e/ff/g',
  ]
  let syncResults: { [k: string]: string | undefined } = {}
  let asyncResults: { [k: string]: string | undefined } = {}
  t.test('sync', t => {
    const pw = new PathScurry(td)
    // readlink on a noent is
    for (const p of paths) {
      syncResults[p] = pw.realpathSync(p)
      t.equal(pw.cwd.resolve(p).realpathSync()?.fullpath(), syncResults[p])
      const onPath = new PathScurry(pw.resolve(p))
      t.equal(
        onPath.realpathSync({ withFileTypes: true })?.fullpath(),
        syncResults[p],
      )
    }
    t.matchSnapshot(syncResults)
    const sr2: typeof syncResults = {}
    for (const p of paths) {
      const entry = pw.realpathSync(p, { withFileTypes: true })
      if (entry) t.type(entry, Path)
      sr2[p] = entry?.fullpath()
    }
    t.same(sr2, syncResults)
    t.end()
  })
  t.test('async', async t => {
    const pw = new PathScurry(td)
    for (const p of paths) {
      asyncResults[p] = await pw.realpath(p)
    }
    t.matchSnapshot(syncResults)
    const ar2: typeof asyncResults = {}
    for (const p of paths) {
      const entry = await pw.realpath(p, { withFileTypes: true })
      if (entry) t.type(entry, Path)
      ar2[p] = entry?.fullpath()
      const onPath = new PathScurry(pw.resolve(p))
      t.equal(
        (await onPath.realpath({ withFileTypes: true }))?.fullpath(),
        ar2[p],
      )
      t.equal(await onPath.realpath(), ar2[p])
    }
    t.same(ar2, asyncResults)
  })

  t.test('walk this beast', async t => {
    const entries: string[] = []
    for await (const entry of new PathScurry(td)) {
      entries.push(entry.fullpath())
    }
    t.matchSnapshot(entries.sort((a, b) => a.localeCompare(b, 'en')))
  })
})

t.test('walking', async t => {
  const td =
    t.testdir({
      y: t.fixture('symlink', 'x'),
      x: {
        outside: '',
      },
      a: {
        x: t.fixture('symlink', '../y'),
        deeplink: t.fixture('symlink', 'b/c/d'),
        empty: {},
        b: {
          c: {
            d: {
              e: '',
              f: '',
              g: '',
              cycle: t.fixture('symlink', '../../..'),
            },
          },
          d: {
            e: '',
            f: '',
            g: '',
            cycle: t.fixture('symlink', '../..'),
          },
        },
      },
    }) + '/a'
  for (const optFirst of [false, true]) {
    for (const filter of [undefined, (e: Path) => e.name !== 'd']) {
      for (const walkFilter of [undefined, (e: Path) => e.name !== 'd']) {
        for (const follow of [false, undefined, true]) {
          for (const reuse of [false, true]) {
            const opts: WalkOptions | undefined =
              !follow && !walkFilter && !filter && !optFirst ?
                undefined
              : {
                  follow,
                  filter,
                  walkFilter,
                }
            const name = [
              `follow=${follow}`,
              `filter=${!!filter}`,
              `walkFilter=${!!walkFilter}`,
            ].join(', ')
            t.test(name, async t => {
              let pw = new PathScurry(td)
              // if not following, then just take the default args when we
              // walk to get the entries, to cover that code path.
              const syncWalk =
                opts ?
                  optFirst ? pw.walkSync({ ...opts, withFileTypes: true })
                  : pw.walkSync('', { ...opts, withFileTypes: true })
                : pw.walkSync()
              const entries = new Set<PathBase>()
              const paths = new Set<string>()

              t.test('initial walk, sync', async t => {
                for (const e of syncWalk) {
                  t.type(e, Path)
                  entries.add(e)
                  paths.add(e.fullpath())
                }
                t.matchSnapshot(paths)
              })

              const withFileTypes = false
              t.test('second walkSync, strings', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<string>()
                for (const path of pw.walkSync('', {
                  ...(opts || {}),
                  withFileTypes,
                })) {
                  found.add(path)
                }
                t.same(found, paths)
              })

              t.test('async walk, objects', async t => {
                if (!reuse) pw = new PathScurry(td)
                const w =
                  opts ?
                    optFirst ? pw.walk({ ...opts, withFileTypes: true })
                    : pw.walk('', { ...opts, withFileTypes: true })
                  : pw.walk()
                const found = new Set<Path>()
                for (const path of await w) {
                  found.add(path)
                  if (reuse && !entries.has(path)) {
                    t.fail('not found in set: ' + path.fullpath())
                  }
                }
                t.match(found, entries)
              })

              t.test('async walk, strings', async t => {
                const found = new Set<string>()
                if (!reuse) pw = new PathScurry(td)
                for (const path of await pw.walk('', {
                  ...(opts || {}),
                  withFileTypes,
                })) {
                  found.add(path)
                  if (!paths.has(path)) {
                    t.fail('not found in set: ' + path)
                  }
                }
                t.same(found, paths)
              })

              if (!opts) {
                // default iterators never follow, filter, etc.
                t.test('for [await] of', async t => {
                  if (!reuse) pw = new PathScurry(td)
                  const found = new Set<Path>()
                  for (const path of pw) {
                    found.add(path)
                    if (reuse && !entries.has(path)) {
                      t.fail('not found in set: ' + path.fullpath())
                    }
                  }
                  t.same(found, entries)

                  if (!reuse) pw = new PathScurry(td)
                  const found2 = new Set<Path>()
                  for await (const path of pw) {
                    found2.add(path)
                    if (reuse && !entries.has(path)) {
                      t.fail('not found in set: ' + path.fullpath())
                    }
                  }
                  t.same(found2, entries)
                })
              }

              t.test('iterateSync', async t => {
                if (!reuse) pw = new PathScurry(td)
                const f =
                  opts ?
                    optFirst ?
                      pw.iterateSync({ ...opts, withFileTypes: true })
                    : pw.iterateSync('', { ...opts, withFileTypes: true })
                  : pw.iterateSync()
                const found = new Set<Path>()
                for (const path of f) {
                  found.add(path)
                  if (reuse && !entries.has(path)) {
                    t.fail('not found in set: ' + path.fullpath())
                  }
                }
                t.same(found, entries)
              })
              t.test('iterateSync strings', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<string>()
                for (const path of pw.iterateSync('', {
                  ...(opts || {}),
                  withFileTypes,
                })) {
                  found.add(path)
                  if (!paths.has(path)) {
                    t.fail('not found: ' + path)
                  }
                }
                t.same(found, paths)
              })

              t.test('async iterate', async t => {
                if (!reuse) pw = new PathScurry(td)
                const f =
                  opts ?
                    optFirst ? pw.iterate({ ...opts, withFileTypes: true })
                    : pw.iterate('', { ...opts, withFileTypes: true })
                  : pw.iterate()
                let found = new Set<Path>()
                for await (const path of f) {
                  found.add(path)
                  if (reuse && !entries.has(path)) {
                    t.fail('not found in set: ' + path.fullpath())
                  }
                }
                t.same(found, entries)
              })

              t.test('async iterate strings', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<string>()
                for await (const path of pw.iterate('', {
                  ...(opts || {}),
                  withFileTypes,
                })) {
                  if (!paths.has(path)) {
                    t.fail('not found in set: ' + path)
                  }
                  found.add(path)
                  if (!paths.has(path)) {
                    t.fail('not found: ' + path)
                  }
                }
                t.same(found, paths)
              })

              t.test('stream', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<Path>()
                const stream =
                  opts ?
                    optFirst ? pw.stream({ ...opts, withFileTypes: true })
                    : pw.stream('', { ...opts, withFileTypes: true })
                  : pw.stream()
                stream.on('data', path => {
                  found.add(path)
                  if (reuse && !entries.has(path)) {
                    t.fail('not foundin set: ' + path.fullpath())
                  }
                })
                await stream.promise()
                t.same(found, entries)
              })

              t.test('stream, strings', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<string>()
                const stream = pw.stream('', {
                  ...(opts || {}),
                  withFileTypes,
                })
                stream.on('data', path => {
                  found.add(path)
                  if (reuse && !paths.has(path)) {
                    t.fail('not foundin set: ' + path)
                  }
                })
                await stream.promise()
                t.same(found, paths)
              })

              t.test('streamSync', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<Path>()
                const stream =
                  opts ?
                    optFirst ?
                      pw.streamSync({ ...opts, withFileTypes: true })
                    : pw.streamSync('', { ...opts, withFileTypes: true })
                  : pw.streamSync()
                stream.on('data', path => {
                  found.add(path)
                  if (reuse && !entries.has(path)) {
                    t.fail('not foundin set: ' + path.fullpath())
                  }
                })
                t.same(found, entries)
              })

              t.test('streamSync, strings', async t => {
                if (!reuse) pw = new PathScurry(td)
                const found = new Set<string>()
                const stream = pw.streamSync('', {
                  ...(opts || {}),
                  withFileTypes,
                })
                stream.on('data', path => {
                  found.add(path)
                  if (reuse && !paths.has(path)) {
                    t.fail('not foundin set: ' + path)
                  }
                })
                t.same(found, paths)
              })
            })
          }
        }
      }
    }
  }
})

t.test('cached methods', t => {
  const td = t.testdir({
    dir: {
      file: '',
    },
    link: t.fixture('symlink', 'dir/file'),
  })
  const pw = new PathScurry(td)
  const dir = pw.cwd.resolve('dir')
  const file = pw.cwd.resolve('dir/file')
  const noent = pw.cwd.resolve('dir/nope')
  const link = pw.cwd.resolve('link')
  t.same(dir.readdirCached(), [], 'has not called readdir')
  t.equal(dir.readdirSync().length, 1)
  t.equal(dir.readdirSync()[0], file)
  t.equal(dir.readdirCached().length, 1)
  t.equal(dir.readdirCached()[0], file)
  t.equal(link.readlinkCached(), undefined)
  t.equal(link.canReadlink(), true)
  t.equal(link.readlinkSync(), file)
  t.equal(link.readlinkCached(), file)
  t.equal(link.canReadlink(), true)
  t.equal(link.realpathCached(), undefined)
  t.equal(link.realpathSync(), file)
  t.equal(link.realpathCached(), file)
  t.equal(link.lstatCached(), undefined)
  t.equal(link.lstatSync(), link)
  t.equal(link.lstatCached(), link)
  t.equal(noent.lstatCached(), undefined)
  t.equal(noent.lstatSync(), undefined)
  t.equal(noent.lstatCached(), undefined)
  t.end()
})

t.test('normalizing unicode pathnames', t => {
  // café
  const cafe1 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()
  // cafe with a `
  const cafe2 = Buffer.from([
    0x63, 0x61, 0x66, 0x65, 0xcc, 0x81,
  ]).toString()
  // CAFÉ
  const cafe1u = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9])
    .toString()
    .toUpperCase()
  // CAFE with a `
  const cafe2u = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81])
    .toString()
    .toUpperCase()

  t.test('nocase: true', t => {
    const nc = new PathScurry('', { nocase: true })
    const cafe1c = nc.cwd.child(cafe1)
    const cafe2c = nc.cwd.child(cafe2)
    const cafe1uc = nc.cwd.child(cafe1u)
    const cafe2uc = nc.cwd.child(cafe2u)

    t.equal(cafe1c, cafe2c)
    t.equal(cafe1c, cafe1uc)
    t.equal(cafe1c, cafe2uc)

    t.equal(cafe1c.isNamed(cafe1), true)
    t.equal(cafe1c.isNamed(cafe2), true)
    t.equal(cafe1c.isNamed(cafe1u), true)
    t.equal(cafe1c.isNamed(cafe2u), true)
    t.equal(cafe2c.isNamed(cafe1), true)
    t.equal(cafe2c.isNamed(cafe2), true)
    t.equal(cafe2c.isNamed(cafe1u), true)
    t.equal(cafe2c.isNamed(cafe2u), true)
    t.equal(cafe1uc.isNamed(cafe1), true)
    t.equal(cafe1uc.isNamed(cafe2), true)
    t.equal(cafe1uc.isNamed(cafe1u), true)
    t.equal(cafe1uc.isNamed(cafe2u), true)
    t.equal(cafe2uc.isNamed(cafe1), true)
    t.equal(cafe2uc.isNamed(cafe2), true)
    t.equal(cafe2uc.isNamed(cafe1u), true)
    t.equal(cafe2uc.isNamed(cafe2u), true)

    t.equal(nc.cwd.children().length, 1)
    t.end()
  })

  t.test('nocase: false', t => {
    const nc = new PathScurry('', { nocase: false })
    const cafe1c = nc.cwd.child(cafe1)
    const cafe2c = nc.cwd.child(cafe2)
    const cafe1uc = nc.cwd.child(cafe1u)
    const cafe2uc = nc.cwd.child(cafe2u)

    t.equal(cafe1c, cafe2c)
    t.equal(cafe1uc, cafe2uc)
    t.not(cafe1c, cafe1uc)
    t.not(cafe2c, cafe2uc)

    t.equal(cafe1c.isNamed(cafe1), true)
    t.equal(cafe1c.isNamed(cafe2), true)
    t.equal(cafe1c.isNamed(cafe1u), false)
    t.equal(cafe1c.isNamed(cafe2u), false)
    t.equal(cafe2c.isNamed(cafe1), true)
    t.equal(cafe2c.isNamed(cafe2), true)
    t.equal(cafe2c.isNamed(cafe1u), false)
    t.equal(cafe2c.isNamed(cafe2u), false)
    t.equal(cafe1uc.isNamed(cafe1), false)
    t.equal(cafe1uc.isNamed(cafe2), false)
    t.equal(cafe1uc.isNamed(cafe1u), true)
    t.equal(cafe1uc.isNamed(cafe2u), true)
    t.equal(cafe2uc.isNamed(cafe1), false)
    t.equal(cafe2uc.isNamed(cafe2), false)
    t.equal(cafe2uc.isNamed(cafe1u), true)
    t.equal(cafe2uc.isNamed(cafe2u), true)

    t.equal(nc.cwd.children().length, 2)
    t.end()
  })

  t.end()
})

t.test('inflight readdirCB calls', t => {
  const td: { [k: string]: {} } = {}
  for (let i = 0; i < 100; i++) {
    td[String(i)] = {}
  }
  const results: Set<string>[] = []
  const ps = new PathScurry(t.testdir(td))
  for (let i = 0; i < 100; i++) {
    ps.cwd.readdirCB((er, res) => {
      if (er) throw er
      results.push(new Set(res.map(r => r.name)))
      if (results.length === 100) next()
    })
  }
  const next = () => {
    t.equal(results[0]?.size, 100)
    for (let i = 1; i < 100; i++) {
      t.same(results[i], results[0])
    }
    t.end()
  }
})

t.test('inflight async readdir calls', t => {
  const td: { [k: string]: {} } = {}
  for (let i = 0; i < 100; i++) {
    td[String(i)] = {}
  }
  const results: Set<string>[] = []
  const ps = new PathScurry(t.testdir(td))
  for (let i = 0; i < 100; i++) {
    ps.cwd.readdir().then(res => {
      results.push(new Set(res.map(r => r.name)))
      if (results.length === 100) next()
    })
  }
  const next = () => {
    t.equal(results[0]?.size, 100)
    for (let i = 1; i < 100; i++) {
      t.same(results[i], results[0])
    }
    t.end()
  }
})

t.test('can use file url as cwd option', t => {
  const fileURL = pathToFileURL(process.cwd())
  const fileURLString = String(fileURL)
  const ps = new PathScurry(process.cwd())
  const pu = new PathScurry(fileURL)
  const pus = new PathScurry(fileURLString)
  t.equal(ps.cwd.fullpath(), process.cwd())
  t.equal(pu.cwd.fullpath(), process.cwd())
  t.equal(pus.cwd.fullpath(), process.cwd())
  t.end()
})

t.test('depth', t => {
  const ps = new PathScurry('/a/b/c/d')
  t.equal(ps.depth(), 4)
  t.equal(ps.depth('e/../g'), 5)
  t.equal(ps.root.depth(), 0)
  t.equal(ps.cwd.depth(), 4)
  t.equal(ps.cwd.parent?.depth(), 3)
  t.end()
})

t.test('lstat() fills out stat fields', async t => {
  const cwd = t.testdir({
    sync: '',
    async: '',
  })
  const ps = new PathScurry(cwd)
  const a = await ps.lstat('async')
  if (!a) throw new Error('failed async lstat')
  const ast = lstatSync(cwd + '/async')
  // some of these became non-iterable in node 24
  const fields = new Set<keyof Stats>(
    (Object.keys(ast) as (keyof Stats)[]).concat([
      'atime',
      'mtime',
      'ctime',
      'birthtime',
    ] as (keyof Stats)[]),
  )
  for (const field of fields) {
    const value = ast[field]
    const found = a[field as keyof Path]
    if (value instanceof Date) {
      t.equal((found as Date).toISOString(), value.toISOString(), field)
    } else {
      t.equal(found, value, field)
    }
  }
  const s = ps.lstatSync('sync')
  if (!s) throw new Error('failed sync lstat')
  const sst = lstatSync(cwd + '/sync')
  for (const field of fields) {
    const value = sst[field]
    const found = s[field as keyof Path]
    if (value instanceof Date) {
      t.equal((found as Date).toISOString(), value.toISOString(), field)
    } else {
      t.equal(found, value, field)
    }
  }
})

t.test('custom FS override option', async t => {
  let calledLstatSync = 0
  let calledLstat = 0
  const myfs: FSOption = {
    lstatSync: (path: string) => {
      calledLstatSync++
      return lstatSync(path)
    },
    promises: {
      lstat: async (path: string) => {
        calledLstat++
        return lstat(path)
      },
    },
  }
  const cwd = t.testdir({})

  const psNoOption = new PathScurry(cwd)
  psNoOption.lstatSync()
  await psNoOption.lstat()
  t.equal(calledLstat, 0)
  t.equal(calledLstatSync, 0)

  const psDefaultOption = new PathScurry(cwd, { fs })
  psDefaultOption.lstatSync()
  await psDefaultOption.lstat()
  t.equal(calledLstat, 0)
  t.equal(calledLstatSync, 0)

  const psCustomFS = new PathScurry(cwd, { fs: myfs })
  psCustomFS.lstatSync()
  await psCustomFS.lstat()
  t.equal(calledLstat, 1)
  t.equal(calledLstatSync, 1)

  const psCustomSync = new PathScurry(cwd, {
    fs: {
      ...myfs,
      promises: undefined,
    },
  })
  psCustomSync.lstatSync()
  await psCustomSync.lstat()
  t.equal(calledLstat, 1)
  t.equal(calledLstatSync, 2)
})

t.test('chdir', async t => {
  const ps = new PathScurry()
  const oldCwd = ps.cwd
  const a = ps.cwd.resolve('a')

  const oldRoot = ps.root
  const rfp = oldRoot.fullpath()
  const rfpp = oldRoot.fullpathPosix()
  t.equal(oldRoot.relative(), rfp)
  t.equal(oldRoot.relativePosix(), rfpp)

  t.equal(a.relative(), 'a')
  t.equal(a.relativePosix(), 'a')
  const bc = a.resolve('b/c')
  t.equal(bc.relativePosix(), 'a/b/c')
  const p = ps.cwd.resolve('..')
  t.equal(p.relative(), '..')

  ps.chdir('x')
  t.equal(a.relativePosix(), '../a')
  t.equal(a.relative(), `..${ps.sep}a`)
  t.equal(bc.relativePosix(), '../a/b/c')
  t.equal(p.relative(), `..${ps.sep}..`)
  t.equal(p.relativePosix(), `../..`)
  t.equal(ps.cwd.resolve('..'), oldCwd)
  t.equal(oldCwd.relative(), '..')
  t.equal(oldCwd.relativePosix(), '..')

  t.equal(ps.root, oldRoot, 'root unchanged')
  t.equal(ps.root.fullpath(), rfp, 'root fullpath unchanged')
  t.equal(ps.root.fullpathPosix(), rfpp, 'root fullpathPosix unchanged')
  t.equal(ps.root.relative(), rfp, 'root relative unchanged')
  t.equal(ps.root.relativePosix(), rfpp, 'root relativePosix unchanged')

  // now change to somewhere a bit more different
  ps.chdir(ps.cwd.resolve('../../i/j/k/l'))
  t.equal(
    oldCwd.relative(),
    relative(ps.cwd.fullpath(), oldCwd.fullpath()),
  )
  t.equal(a.relative(), relative(ps.cwd.fullpath(), a.fullpath()))
  t.equal(bc.relative(), relative(ps.cwd.fullpath(), bc.fullpath()))

  // verify no-op changes nothing
  const expect = {
    newCwd: ps.cwd.fullpath(),
    oldcwdf: oldCwd.fullpath(),
    oldcwdr: oldCwd.relative(),
    oldcwdrp: oldCwd.relativePosix(),
    ar: a.relative(),
    arp: a.relativePosix(),
    rr: oldRoot.relative(),
    rrp: oldRoot.relativePosix(),
  }
  ps.chdir(ps.cwd.fullpath())
  t.strictSame(
    {
      newCwd: ps.cwd.fullpath(),
      oldcwdf: oldCwd.fullpath(),
      oldcwdr: oldCwd.relative(),
      oldcwdrp: oldCwd.relativePosix(),
      ar: a.relative(),
      arp: a.relativePosix(),
      rr: oldRoot.relative(),
      rrp: oldRoot.relativePosix(),
    },
    expect,
  )
})

t.test('link targets in multiply nested symlinks', async t => {
  const cwd = t.testdir({
    dir_baz: {
      bar: t.fixture('symlink', '../dir_bar'),
    },
    dir_bar: {
      foo: t.fixture('symlink', '../dir_foo'),
    },
    dir_foo: {
      'foo.txt': 'hello',
    },
  })
  t.test('async', async t => {
    const p = new PathScurry(cwd)
    const link = p.cwd.resolve('./dir_baz/bar/foo')
    t.ok(await (await link.readlink())?.lstat(), 'found the link target')
  })
  t.test('sync', t => {
    const p = new PathScurry(cwd)
    const link = p.cwd.resolve('./dir_baz/bar/foo')
    t.ok(link.readlinkSync()?.lstatSync(), 'found the link target')
    t.end()
  })
})
