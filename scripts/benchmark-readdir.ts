#!/usr/bin/env node --expose_gc --loader=ts-node/esm

import { Dir, Dirent, opendirSync, readdirSync, writeFileSync } from 'fs'
import { opendir, readdir } from 'fs/promises'
import { mkdirpSync } from 'mkdirp'
import { resolve } from 'path'

// depth to go in
const D = 4
// count of items to put in each folder
const C = 10
const setup = (
  dir: string,
  d: number = D,
  c: number = C,
  dirs: string[] = []
) => {
  if (d === 0) {
    mkdirpSync(dir)
    for (let i = 0; i < c; i++) {
      writeFileSync(`${dir}/${i}${i}`, '')
    }
    return
  }
  for (let i = 0; i < c; i++) {
    setup(`${dir}/${i}`, d - 1, c, dirs)
  }
}

const dir = resolve(__dirname) + '/fixture'
setup(dir)
// process.on('exit', () => rimrafSync(dir))

import { PathBase, PathWalker } from '../'

const walkFreshPWSyncRecurse = (done: () => any) => {
  const pw = new PathWalker(dir)
  const walk = (p: PathBase) => {
    for (const path of pw.readdirSync(p)) {
      walk(path)
    }
  }
  walk(pw.cwd)
  done()
}

// const walkFreshPWSyncIterate = (done: () => any) => {
//   const pw = new PathWalker(dir)
//   const walk = (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of pw.readdirSync(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pw.cwd)
//   done()
// }

const walkFreshPWAsyncRecurse = (done: () => any) => {
  const pw = new PathWalker(dir)
  const walk = async (p: PathBase) => {
    const promises: Promise<void>[] = []
    for (const path of await pw.readdir(p)) {
      promises.push(walk(path))
    }
    await Promise.all(promises)
  }
  walk(pw.cwd).then(done)
}

// const walkFreshPWAsyncIterate = (done: () => any) => {
//   const pw = new PathWalker(dir)
//   const walk = async (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of await pw.readdir(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pw.cwd).then(done)
// }

const pwAsync = new PathWalker(dir)
const walkReusePWAsyncRecurse = (done: () => any) => {
  const walk = async (p: PathBase) => {
    const promises: Promise<void>[] = []
    for (const path of await pwAsync.readdir(p)) {
      promises.push(walk(path))
    }
    await Promise.all(promises)
  }
  walk(pwAsync.cwd).then(done)
}

// const walkReusePWAsyncIterate = (done: () => any) => {
//   const walk = async (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of await pwAsync.readdir(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pwAsync.cwd).then(done)
// }

const pwSync = new PathWalker(dir)
const walkReusePWSyncRecurse = (done: () => any) => {
  const walk = (p: PathBase) => {
    for (const path of pwSync.readdirSync(p)) {
      walk(path)
    }
  }
  walk(pwSync.cwd)
  done()
}

// const walkReusePWSyncIterate = (done: () => any) => {
//   const walk = async (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of pwSync.readdirSync(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pwSync.cwd)
//   done()
// }

const walkFsReaddirAsyncRecurse = (done: () => any) => {
  const walk = async (p: string) => {
    const entries = await readdir(dir, { withFileTypes: true })
    const promises:Promise<void>[] = []
    for (const entry of entries) {
      promises.push(walk(resolve(p, entry.name)))
    }
    await Promise.all(promises)
  }
  walk(dir).then(done)
}

// const walkFsReaddirAsyncIterate = (done: () => any) => {
//   const walk = async (p: string) => {
//     const paths: string[] = [p]
//     for (const path of paths) {
//       const entries = await readdir(dir, {
//         withFileTypes: true,
//       }).catch(() => [])
//       for (const entry of entries) {
//         paths.push(resolve(path, entry.name))
//       }
//     }
//   }
//   walk(dir).then(done)
// }

const walkFsReaddirSyncRecurse = (done: () => any) => {
  const walk = (p: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      entries = []
    }
    for (const entry of entries) {
      walk(resolve(p, entry.name))
    }
  }
  walk(dir)
  done()
}

const walkFsOpendirAsyncRecurse = (done: () => any) => {
  const walk = async (p: string) => {
    const dir = await opendir(p).catch(() => [])
    const promises: Promise<void>[] = []
    for await (const entry of dir) {
      promises.push(walk(resolve(p, entry.name)))
    }
    await Promise.all(promises)
  }
  walk(dir).then(done)
}

// const walkFsReaddirSyncIterate = (done: () => any) => {
//   const walk = (p: string) => {
//     const paths: string[] = [p]
//     let path: string | undefined
//     while ((path = paths.shift())) {
//       let entries: Dirent[]
//       try {
//         entries = readdirSync(path, { withFileTypes: true })
//       } catch (_) {
//         entries = []
//       }
//       for (const p of entries) {
//         paths.push(resolve(path, p.name))
//       }
//     }
//   }
//   walk(dir)
//   done()
// }

const walkFsOpendirSyncRecurse = (done: () => any) => {
  const walk = (p: string) => {
    let dir: Dir
    try {
      dir = opendirSync(p)
    } catch (_) {
      dir = { readSync: () => null, closeSync: () => {} } as Dir
    }
    try {
      let e: Dirent | null
      while ((e = dir.readSync())) {
        walk(resolve(p, e.name))
      }
    } finally {
      dir.closeSync()
    }
  }
  walk(dir)
  done()
}

// const walkFsOpendirAsyncIterate = (done: () => any) => {
//   const walk = async (p: string) => {
//     const paths: string[] = [resolve(dir, p)]
//     let path: string | undefined
//     while ((path = paths.shift())) {
//       const pp = path
//       const dir = await opendir(pp).catch(() => [])
//       for await (const entry of dir) {
//         paths.push(resolve(pp, entry.name))
//       }
//     }
//   }
//   walk(dir).then(done)
// }
//
// const walkFsOpendirSyncIterate = (done: () => any) => {
//   const walk = (p: string) => {
//     const paths: string[] = [resolve(dir, p)]
//     let path: string | undefined
//     while ((path = paths.shift())) {
//       let entries: Dirent[]
//       try {
//         entries = readdirSync(path, { withFileTypes: true })
//       } catch (_) {
//         entries = []
//       }
//       for (const p of entries) {
//         paths.push(resolve(path, p.name))
//       }
//     }
//   }
//   walk(dir)
//   done()
// }

const N = 1
const run = async (fn: (done: () => void) => void) => {
  gc && gc()
  const start = performance.now()
  const e = start + 1000
  let count = 0
  while (performance.now() < e) {
    for (let i = 0; i < N; i++) {
      await new Promise<void>(res => fn(res))
    }
    count += N * 111111
  }
  const elapsed = performance.now() - start
  const score = count / elapsed
  return score
}

const cases: [string, (done: () => void) => void][] = [
  ['recursive fresh PW async', walkFreshPWAsyncRecurse],
  ['recursive reuse PW async', walkReusePWAsyncRecurse],
  ['recursive fs opendir async', walkFsOpendirAsyncRecurse],

  ['recursive fresh PW sync', walkFreshPWSyncRecurse],
  ['recursive reuse PW sync', walkReusePWSyncRecurse],
  ['recursive fs opendir sync', walkFsOpendirSyncRecurse],

  // the iterative approaches are super slow, don't even bother
  // ['iterative fresh PW async', walkFreshPWAsyncIterate],
  // ['iterative fresh PW sync', walkFreshPWSyncIterate],
  // ['iterative reuse PW async', walkReusePWAsyncIterate],
  // ['iterative reuse PW sync', walkReusePWSyncIterate],
  // ['iterative fs opendir async', walkFsOpendirAsyncIterate],
  // ['iterative fs opendir sync', walkFsOpendirSyncIterate],

  // these crash with OOM errors because too much GC
  // using the dir iterator is super worthwhile.
  // ['recursive fs readdir async', walkFsReaddirAsyncRecurse],
  // ['recursive fs readdir sync', walkFsReaddirSyncRecurse],
  // ['iterative fs readdir async', walkFsReaddirAsyncIterate],
]

const main = async () => {
  console.log('operations / second, higher score number better')
  for (const [name, fn] of cases) {
    process.stdout.write(`${name}: `)
    const score = await run(fn)
    console.log(score)
  }
}

main()
