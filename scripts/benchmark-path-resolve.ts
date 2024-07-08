#!/usr/bin/env node --expose_gc --loader=ts-node/esm --no-warnings

console.log('Testing performance compared with path.resolve()')

// Test performance against the built-in path.resolve()
//
// Since PathScurry is optimized for cases where the *same*
// paths potentially get resolved repeatedly (as in a glob
// walk, or other cases where the paths being resolved refer
// to real file system entries), note that the ${RANDOM} case
// completely destroys it, because it is always missing the
// cache, and thus doing way more work than simple string
// munging.
//
// But, in the cases where the paths are repeatedly resolved,
// caching the resolution improves things dramatically.
//
// Note that the `${RANDOM}` tests are down across all implementations,
// because it's taking the hit of calling Math.random() and doing a
// string replace in all of them.  Numbers should be compared relatively
// in those cases, not treated as representative absolute perf metrics,
// unless you're doing Math.random() and string.replace() as part of your
// path resolution process, in which case, don't do that lol.

import { posix } from 'path'
import {
  PathBase,
  PathScurryPosix,
  PathScurryWin32,
} from '../dist/esm/index.js'
const posixResolve = posix.resolve
const win32Resolve = posix.resolve

const pwp = new PathScurryPosix(process.cwd(), { nocase: false })
const pww = new PathScurryWin32(process.cwd(), { nocase: false })

const N = 1_000
const p = 'a/b/c/../d/e/f////g/h/i/j/../j/k'
const abs = '/x/y/z'
// completely random each time
const rnd = '${RANDOM}'
// an incrementing number % 10
const mod = '${MOD}'

const replaceRandom = ([s, t]: [s: string, t?: string]): [
  string,
  string | undefined,
] =>
  (s && s.includes('${RANDOM}')) || (t && t.includes('${RANDOM}')) ?
    [
      s && s.replace(/\$\{RANDOM\}/, String(Math.random())),
      t && t.replace(/\$\{RANDOM\}/, String(Math.random())),
    ]
  : [s, t]
let modInc = 0
const replaceMod = ([s, t]: [s: string, t?: string]): [
  string,
  string | undefined,
] => {
  modInc = (modInc + 1) % 10
  return (s && s.includes('${MOD}')) || (t && t.includes('${MOD}')) ?
      [
        s && s.replace(/\$\{MOD\}/, String(modInc)),
        t && t.replace(/\$\{MOD\}/, String(modInc)),
      ]
    : [s, t]
}
const run = (
  r: (s: string, t?: string) => string | PathBase,
  s: string,
  t?: string,
) => {
  gc && gc()
  const start = performance.now()
  const e = start + 1000
  let count = 0
  while (performance.now() < e) {
    for (let i = 0; i < N; i++) {
      const [ss, tt] = replaceMod(replaceRandom([s, t]))
      r(ss, tt)
    }
    count += N
  }
  const end = performance.now()
  return count / (end - start)
}

const pathResolve = (s: string, t?: string) =>
  t === undefined ? posixResolve(s) : posixResolve(s, t)
const pathWinResolve = (s: string, t?: string) =>
  t === undefined ? win32Resolve(s) : win32Resolve(s, t)

const pwpResolve = (s: string, t?: string) =>
  t === undefined ? pwp.resolve(s) : pwp.resolve(s, t)
const pwwResolve = (s: string, t?: string) =>
  t === undefined ? pww.resolve(s) : pww.resolve(s, t)

console.log('showing results in operations / ms (bigger is better)')
const cases = [
  [abs],
  [p],
  [abs, p],
  [p, abs],
  [p, rnd],
  [rnd, abs],
  [abs, rnd],
  [p, mod],
  [mod, abs],
  [abs, mod],
] as const
const { format } = new Intl.NumberFormat('en', {
  maximumFractionDigits: 2,
})
for (const [s, t] of cases) {
  process.stderr.write('.')
  const prwin = run(pathWinResolve, s, t)
  process.stderr.write('.')
  const prnix = run(pathResolve, s, t)
  process.stderr.write('.')
  const pwp = run(pwpResolve, s, t)
  process.stderr.write('.')
  const pww = run(pwwResolve, s, t)
  process.stderr.write('.')
  console.log(`\r(${s}${t ? ',' + t : ''})`, {
    'path.win32.resolve()': format(prwin),
    'path.posix.resolve()': format(prnix),
    PathScurryPosix: format(pwp),
    PathScurryWin32: format(pww),
  })
}
