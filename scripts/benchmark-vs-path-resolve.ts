import {posix, win32} from 'path'
const posixResolve = posix.resolve
const win32Resolve = posix.resolve
import {Path, PathWalker} from '../'

const pw = new PathWalker(process.cwd(), { nocase: false })

const N = 1_000
const p = 'a/b/c/../d/e/f////g/h/i/j/../j/k'
const abs = '/x/y/z'

const run = (r: (s: string, t?: string) => string| Path, s: string, t?: string) => {
  const start = performance.now()
  const e = start + 1000
  let count = 0
  while (performance.now() < e) {
    for (let i = 0; i < N; i++) {
      r(s, t)
    }
    count += N
  }
  const end = performance.now()
  return count / (end - start)
}

const pathResolveDouble = (s: string, t?: string) =>
  t === undefined ? posixResolve(s) : posixResolve(posixResolve(s), t)
const pathWinResolveDouble = (s: string, t?: string) =>
  t === undefined ? win32Resolve(s) : win32Resolve(win32Resolve(s), t)
const pathResolveSingle = (s: string, t?: string) =>
  t === undefined ? posixResolve(s) : posixResolve(s, t)
const pathWinResolveSingle = (s: string, t?: string) =>
  t === undefined ? win32Resolve(s) : win32Resolve(s, t)

const pwResolve = (s: string, t?: string) =>
  t === undefined ? pw.resolve(s) : pw.resolve(pw.resolve(s), t)

console.log('showing results in operations / ms (bigger is better)')
const cases = [
  [abs],
  [p],
  [abs, p],
  [p, abs],
]
for (const [s, t] of cases) {
  const prwin1 = run(pathWinResolveSingle, s, t)
  const prwin2 = run(pathWinResolveDouble, s, t)
  const prnix1 = run(pathResolveSingle, s, t)
  const prnix2 = run(pathResolveDouble, s, t)
  const pw = run(pwResolve, s, t)
  console.log(`(${s}${t ? ',' + t:''})`, {
    prwin1,
    prwin2,
    prnix1,
    prnix2,
    pw,
  })
}
