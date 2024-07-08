#!/usr/bin/env node --expose_gc --loader=ts-node/esm --no-warnings

console.log(`comparing performance against a naive fs readdir walk`)

// note that the "reuse pw" cases are MUCH faster for item counts up
// to 150k or so. The sync reuse case is so wildly fast in that case
// because it is just benchmarking the LRUCache.  The async case is
// gated by the speed of Promise resolution.
//
// Above 200k - 300k entries, the advantage starts to decline, as it
// gets further past the default childrenCacheSize value of 16*1024.
//
// At 500k to 1M entries, PathScurry isn't significantly faster than
// the naive fs walk, and the program is gated by syscalls and garbage
// collection. The sync case gets noticeably slower than async.
//
// But, it doesn't crash the JS heap, since old entries are discarded
// as new entries keep being added.
//
// The fs.readdir() walks are commented out because I couldn't figure
// out how to make them stop crashing the JS heap, even for relatively
// modest fs entry counts. I'm not sure why it would be a problem,
// especially since PathScurry uses fs.readdir() rather than opendir.

import { walk, walkStream, walkSync } from '@nodelib/fs.walk'
import { Dir, Dirent, opendirSync, writeFileSync } from 'fs'
import { opendir, readdir } from 'fs/promises'
import { mkdirpSync } from 'mkdirp'
import { cpus } from 'os'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
// import { rimrafSync } from 'rimraf'

// depth to go in
const D = 6
// count of items to put in each folder
const C = 10
// max number of things to make, in total
const max: number = +(process.argv[2] || 100_000)
let totalCreated = 0
let saidDone = false
const sayDone = () => {
  if (saidDone) {
    return
  }
  saidDone = true
  console.log(`Creating ${max} file system entries...done!             `)
}
let saidCreating = false
const sayCreating = () => {
  if (saidCreating) return
  saidCreating = true
  process.stdout.write(`Creating ${max} file system entries...\r`)
}
const sayCreated =
  process.stdout.isTTY ?
    () => {
      if (totalCreated % 1000 === 0) {
        process.stdout.write(
          `Creating ${max} file system entries...${totalCreated}          \r`,
        )
      }
    }
  : () => {}

const setup = (
  dir: string,
  d: number = D,
  c: number = C,
  dirs: string[] = [],
) => {
  if (d === D) sayCreating()

  mkdirpSync(dir)
  totalCreated++
  if (totalCreated >= max) {
    sayDone()
    return
  }
  if (totalCreated % 1000 === 0) {
    sayCreated()
  }

  if (d === 0) {
    for (let i = 0; i < c; i++) {
      const p = `${dir}/${i}${i}`
      writeFileSync(p, '')
      totalCreated++
      if (totalCreated >= max) {
        sayDone()
        return
      }
      if (totalCreated % 1000 === 0) {
        sayCreated()
      }
    }
    return
  }

  for (let i = 0; i < c; i++) {
    setup(`${dir}/${i}`, d - 1, c, dirs)
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dir = resolve(__dirname) + '/fixture'
process.stdout.write('cleaning fixture...\r')
// rimrafSync(dir)
console.log('cleaning fixture...done!')

import { Path, PathScurry } from '../dist/esm/index.js'

const fsWalkStream = (done: () => any) => {
  const stream = walkStream(dir)
  stream.on('end', done)
  stream.resume()
}

const fsWalkAsync = (done: () => any) => {
  walk(dir, done)
}

const fsWalkSync = (done: () => any) => {
  walkSync(dir)
  done()
}

const pwWalkFreshAsync = (done: () => any) => {
  new PathScurry(dir).walk().then(done)
}
const pwWalkFreshSync = (done: () => any) => {
  new PathScurry(dir).walkSync()
  done()
}
const pwWalkFreshIterateSync = (done: () => any) => {
  for (const _ of new PathScurry(dir).iterateSync()) {
  }
  done()
}
const pwWalkFreshStriterateSync = (done: () => any) => {
  for (const _ of new PathScurry(dir).streamSync()) {
  }
  done()
}
// const pwWalkFreshForOf = (done: () => any) => {
//   for (const _ of new PathScurry(dir)) {
//   }
//   done()
// }
const pwWalkFreshIterate = (done: () => any) => {
  const x = async () => {
    for await (const _ of new PathScurry(dir).iterate()) {
    }
  }
  x().then(done)
}
const pwWalkFreshStriterate = (done: () => any) => {
  const x = async () => {
    for await (const _ of new PathScurry(dir).stream()) {
    }
  }
  x().then(done)
}
// const pwWalkFreshForAwaitOf = (done: () => any) => {
//   const x = async () => {
//     for await (const _ of new PathScurry(dir)) {
//     }
//   }
//   x().then(done)
// }
const pwWalkFreshStream = (done: () => any) => {
  new PathScurry(dir).stream().on('end', done).resume()
}
const pwWalkFreshStreamSync = (done: () => any) => {
  new PathScurry(dir).streamSync().resume()
  done()
}

const pwWalkReuseAsync = (done: () => any) => {
  pwReuse.walk().then(done)
}
const pwWalkReuseSync = (done: () => any) => {
  pwReuse.walkSync()
  done()
}
const pwWalkReuseIterateSync = (done: () => any) => {
  for (const _ of pwReuse.iterateSync()) {
  }
  done()
}
// const pwWalkReuseForOf = (done: () => any) => {
//   for (const _ of pwReuse) {
//   }
//   done()
// }
const pwWalkReuseIterate = (done: () => any) => {
  const x = async () => {
    for await (const _ of pwReuse.iterate()) {
    }
  }
  x().then(done)
}
// const pwWalkReuseForAwaitOf = (done: () => any) => {
//   const x = async () => {
//     for await (const _ of pwReuse) {
//     }
//   }
//   x().then(done)
// }
const pwWalkReuseStream = (done: () => any) => {
  pwReuse.stream().on('end', done).resume()
}
const pwWalkReuseStreamSync = (done: () => any) => {
  pwReuse.streamSync().resume()
  done()
}
const pwWalkReuseStriterate = (done: () => any) => {
  const x = async () => {
    for await (const _ of pwReuse.stream()) {
    }
  }
  x().then(done)
}
const pwWalkReuseStriterateSync = (done: () => any) => {
  for (const _ of pwReuse.streamSync()) {
  }
  done()
}

const walkFreshPWSyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const pw = new PathScurry(dir)
    const walk = (p: Path) => {
      for (const path of pw.readdirSync(p)) {
        if (!check || path.isDirectory()) {
          walk(path)
        }
      }
    }
    walk(pw.cwd)
    done()
  }

// const walkFreshPWSyncIterate = (done: () => any) => {
//   const pw = new PathScurry(dir)
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

const walkFreshPWCBRecurse =
  (check: boolean = true, zalgo: boolean = false) =>
  (done: () => any) => {
    const pw = new PathScurry(dir)
    const walk = async (path: Path, cb: () => any) => {
      path.readdirCB((_er, entries) => {
        let len = entries.length
        if (!len) cb()
        const next = () => {
          if (--len <= 0) cb()
        }
        for (const e of entries) {
          if (!check || e.isDirectory()) {
            walk(e, next)
          } else {
            next()
          }
        }
      }, zalgo)
    }
    walk(pw.cwd, done)
  }

const walkFreshPWAsyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const pw = new PathScurry(dir)
    const walk = async (p: Path) => {
      const promises: Promise<void>[] = []
      for (const path of await p.readdir()) {
        if (!check || path.isDirectory()) {
          promises.push(walk(path))
        }
      }
      await Promise.all(promises)
    }
    walk(pw.cwd).then(done)
  }

// this is consistently slower than not using a stack
// const walkFreshPWAsyncRecurseStack =
//   (check: boolean = true) =>
//   (done: () => any) => {
//     const stack: Path[] = []
//     const pw = new PathScurry(dir)
//     const walk = async (p: Path) => {
//       for (const path of await pw.readdir(p)) {
//         if (!check || path.isDirectory()) {
//           stack.push(path)
//         }
//       }
//       await process()
//     }
//     const limit = cpus().length * 4
//     const process = async () => {
//       let f = stack.pop()
//       if (f) await walk(f)
//     }
//     stack.push(pw.cwd)
//     const workers: Promise<void>[] = []
//     for (let i = 0; i < limit; i++) {
//       workers.push(process())
//     }
//     Promise.all(workers).then(done)
//   }

// const walkFreshPWAsyncIterate = (done: () => any) => {
//   const pw = new PathScurry(dir)
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

const walkReusePWAsyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const walk = async (p: Path) => {
      const promises: Promise<void>[] = []
      for (const path of await p.readdir()) {
        if (!check || path.isDirectory()) {
          promises.push(walk(path))
        }
      }
      await Promise.all(promises)
    }
    walk(pwReuse.cwd).then(done)
  }

const walkReusePWCBRecurse =
  (check: boolean = true, zalgo: boolean = false) =>
  (done: () => any) => {
    const walk = async (path: Path, cb: () => any) => {
      path.readdirCB((_er, entries) => {
        let len = entries.length
        if (!len) cb()
        const next = () => {
          if (--len <= 0) cb()
        }
        for (const e of entries) {
          if (!check || e.isDirectory()) {
            walk(e, next)
          } else {
            next()
          }
        }
      }, zalgo)
    }
    walk(pwReuse.cwd, done)
  }

// this is consistently slower than not using a stack
// const walkReusePWAsyncRecurseStack =
//   (check: boolean = true) =>
//   (done: () => any) => {
//     const stack: Path[] = []
//     const pw = pwReuse
//     const walk = async (p: Path) => {
//       for (const path of await pw.readdir(p)) {
//         if (!check || path.isDirectory()) {
//           stack.push(path)
//         }
//       }
//       await process()
//     }
//     const limit = cpus().length
//     const process = async () => {
//       let f = stack.pop()
//       if (f) await walk(f)
//     }
//     stack.push(pw.cwd)
//     const workers: Promise<void>[] = []
//     for (let i = 0; i < limit; i++) {
//       workers.push(process())
//     }
//     Promise.all(workers).then(done)
//   }

// consistently slower than recursive approach
// const walkReusePWAsyncIterate = (done: () => any) => {
//   const walk = async (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of await pwReuse.readdir(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pwReuse.cwd).then(done)
// }

const walkReusePWSyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const walk = (p: Path) => {
      for (const path of pwReuse.readdirSync(p)) {
        if (!check || path.isDirectory()) {
          walk(path)
        }
      }
    }
    walk(pwReuse.cwd)
    done()
  }

// const walkReusePWSyncIterate = (done: () => any) => {
//   const walk = async (p: PathBase) => {
//     const paths: PathBase[] = [p]
//     let path: PathBase | undefined
//     while ((path = paths.shift())) {
//       for (const p of pwReuse.readdirSync(path)) {
//         paths.push(p)
//       }
//     }
//   }
//   walk(pwReuse.cwd)
//   done()
// }

// doing this one without a stack and set of workers
// causes the JS heap to overflow, every time.
const walkFsReaddirAsyncRecurseStack =
  (check: boolean = true) =>
  (done: () => any) => {
    const stack: string[] = []
    const walk = async (p: string) => {
      const entries = await readdir(p, { withFileTypes: true }).catch(
        () => [],
      )
      for (const entry of entries) {
        if (!check || entry.isDirectory()) {
          stack.push(resolve(p, entry.name))
        }
      }
      await process()
    }
    const limit = cpus().length
    const process = async () => {
      let f = stack.pop()
      if (f) await walk(f)
    }
    stack.push(dir)
    const workers: Promise<void>[] = []
    for (let i = 0; i < limit; i++) {
      workers.push(process())
    }
    Promise.all(workers).then(done)
  }

// this one always crashes, very frustrating
// const walkFsReaddirAsyncRecurse = (done: () => any) => {
//   const walk = async (p: string) => {
//     const entries = await readdir(dir, { withFileTypes: true })
//     const promises: Promise<void>[] = []
//     for (const entry of entries) {
//       if (entry.isDirectory()) {
//         promises.push(walk(resolve(p, entry.name)))
//       }
//     }
//     return await Promise.all(promises).then(() => {})
//   }
//   walk(dir).then(done)
// }
//
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
//
// const walkFsReaddirSyncRecurse = (done: () => any) => {
//   const walk = (p: string) => {
//     let entries: Dirent[]
//     try {
//       entries = readdirSync(dir, { withFileTypes: true })
//     } catch (_) {
//       entries = []
//     }
//     for (const entry of entries) {
//       walk(resolve(p, entry.name))
//     }
//   }
//   walk(dir)
//   done()
// }

const walkFsOpendirAsyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const walk = async (p: string) => {
      const dir = await opendir(p).catch(() => [])
      const promises: Promise<void>[] = []
      for await (const entry of dir) {
        if (!check || entry.isDirectory()) {
          promises.push(walk(resolve(p, entry.name)))
        }
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

const walkFsOpendirSyncRecurse =
  (check: boolean = true) =>
  (done: () => any) => {
    const walk = (p: string) => {
      let dir: Dir
      try {
        dir = opendirSync(p)
        try {
          let e: Dirent | null
          while ((e = dir.readSync())) {
            if (!check || e.isDirectory()) {
              walk(resolve(p, e.name))
            }
          }
        } finally {
          dir.closeSync()
        }
      } catch (_) {}
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
  const e = start + 3000
  let count = 0
  while (performance.now() < e) {
    for (let i = 0; i < N; i++) {
      try {
        await new Promise<void>(res => fn(res))
      } catch (er) {
        console.error(er)
        return NaN
      }
    }
    count += N * totalCreated
  }
  const elapsed = performance.now() - start
  gc && gc()
  const score = count / elapsed
  return score
}

const cases: () => (
  | [string, (done: () => void) => void]
  | string
)[] = () => [
  'Fresh PathScurry.walk()',
  ['stream', pwWalkFreshStream],
  ['sync stream', pwWalkFreshStreamSync],
  ['async walk', pwWalkFreshAsync],
  [' sync walk', pwWalkFreshSync],
  ['async iter', pwWalkFreshIterate],
  [' sync iter', pwWalkFreshIterateSync],
  ['async stream iter', pwWalkFreshStriterate],
  [' sync stream iter', pwWalkFreshStriterateSync],
  // no discernable difference between for/[await/]of and
  // calling the iterator directly.
  // ['  fao', pwWalkFreshForAwaitOf],
  // ['   fo', pwWalkFreshForOf],

  'Reuse PathScurry.walk()',
  ['  stream', pwWalkReuseStream],
  ['sync stream', pwWalkReuseStreamSync],
  ['async walk', pwWalkReuseAsync],
  [' sync walk', pwWalkReuseSync],
  ['async iter', pwWalkReuseIterate],
  [' sync iter', pwWalkReuseIterateSync],
  ['async stream iter', pwWalkReuseStriterate],
  [' sync stream iter', pwWalkReuseStriterateSync],
  // ['  fao', pwWalkReuseForAwaitOf],
  // ['   fo', pwWalkReuseForOf],

  'Reuse PathScurry, manual, check isDirectory()',
  ['async', walkReusePWAsyncRecurse(true)],
  ['   cb', walkReusePWCBRecurse(true)],
  ['zalgo', walkReusePWCBRecurse(true, true)],
  [' sync', walkReusePWSyncRecurse(true)],

  'Reuse PathScurry, manual, no isDirectory() check',
  ['async', walkReusePWAsyncRecurse(false)],
  ['   cb', walkReusePWCBRecurse(false)],
  ['zalgo', walkReusePWCBRecurse(false, true)],
  [' sync', walkReusePWSyncRecurse(false)],

  'Fresh PathScurry, manual, check isDirectory()',
  ['async', walkFreshPWAsyncRecurse(true)],
  ['   cb', walkFreshPWCBRecurse(true)],
  ['zalgo', walkFreshPWCBRecurse(true, true)],
  [' sync', walkFreshPWSyncRecurse(true)],

  'Fresh PathScurry, manual, no isDirectory() check',
  ['async', walkFreshPWAsyncRecurse(false)],
  ['   cb', walkFreshPWCBRecurse(false)],
  ['zalgo', walkFreshPWCBRecurse(false, true)],
  [' sync', walkFreshPWSyncRecurse(false)],

  '@nodelib/fs.walk',
  ['stream', fsWalkStream],
  [' async', fsWalkAsync],
  ['  sync', fsWalkSync],

  'stop',

  'fs.opendir() iteration, check isDirectory()',
  [' async', walkFsOpendirAsyncRecurse(true)],
  ['  sync', walkFsOpendirSyncRecurse(true)],
  'fs.opendir() iteration, no check',
  [' async', walkFsOpendirAsyncRecurse(false)],
  ['  sync', walkFsOpendirSyncRecurse(false)],

  'fs.readdir() with promise stack, check isDirectory()',
  [' async', walkFsReaddirAsyncRecurseStack(true)],
  'fs.readdir() with promise stack, no check',
  [' async', walkFsReaddirAsyncRecurseStack(false)],

  // 'PathScurry async with promise stack, no check',
  // ['fresh', walkFreshPWAsyncRecurseStack(false)],
  // ['reuse', walkReusePWAsyncRecurseStack(false)],

  // the iterative approaches are super slow, don't even bother
  // ['iterative fresh PW async', walkFreshPWAsyncIterate],
  // ['iterative fresh PW sync', walkFreshPWSyncIterate],
  // ['iterative reuse PW async', walkReusePWAsyncIterate],
  // ['iterative reuse PW sync', walkReusePWSyncIterate],
  // ['iterative fs opendir async', walkFsOpendirAsyncIterate],
  // ['iterative fs opendir sync', walkFsOpendirSyncIterate],

  // these crash with OOM errors because too much GC
  // ['recursive fs readdir async', walkFsReaddirAsyncRecurse],
  // ['recursive fs readdir sync', walkFsReaddirSyncRecurse],
  // ['iterative fs readdir async', walkFsReaddirAsyncIterate],
]

const pwReuse = new PathScurry(dir)
const main = async () => {
  setup(dir)
  console.log('showing results in operations / second (bigger is better)')
  const allCases = cases()
  const namelen = allCases
    .filter(a => Array.isArray(a))
    .reduce((a, b) => Math.max(a, b[0].length), 0)
  for (const entry of cases()) {
    if (entry === 'stop') break
    if (typeof entry === 'string') {
      console.log(entry)
      continue
    }
    const [name, fn] = entry
    process.stdout.write(`  ${name}: `.padStart(namelen + 6))
    const score = await run(fn)
    const r = Math.floor(score)
    const d = '.' + Math.floor((score - r) * 1000)
    console.log(`${Math.round(score)}`.padStart(5) + d)
  }
}

main()
