/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/index.ts TAP eloop async > must match snapshot 1`] = `
Object {
  "a/bb/c/dd/e/ff/g": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g",
  "aa/b/cc/d/ee/f/gg": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g",
  "bigloop": undefined,
  "dest": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/dest",
  "enoent": undefined,
  "pivot": undefined,
  "roundtrip": "{CWD}/test/tap-testdir-index-eloop/home",
}
`

exports[`test/index.ts TAP eloop sync > must match snapshot 1`] = `
Object {
  "a/bb/c/dd/e/ff/g": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g",
  "aa/b/cc/d/ee/f/gg": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g",
  "bigloop": undefined,
  "dest": "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/dest",
  "enoent": undefined,
  "pivot": undefined,
  "roundtrip": "{CWD}/test/tap-testdir-index-eloop/home",
}
`

exports[`test/index.ts TAP eloop walk this beast > must match snapshot 1`] = `
Array [
  "{CWD}/test/tap-testdir-index-eloop",
  "{CWD}/test/tap-testdir-index-eloop/a",
  "{CWD}/test/tap-testdir-index-eloop/a/b",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/bounce",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/dest",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/g/up",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/gg",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/f/up",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/ff",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/e/up",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/ee",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/d/up",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/dd",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/b/c/up",
  "{CWD}/test/tap-testdir-index-eloop/a/b/cc",
  "{CWD}/test/tap-testdir-index-eloop/a/b/down",
  "{CWD}/test/tap-testdir-index-eloop/a/b/round",
  "{CWD}/test/tap-testdir-index-eloop/a/b/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/b/up",
  "{CWD}/test/tap-testdir-index-eloop/a/bb",
  "{CWD}/test/tap-testdir-index-eloop/a/down",
  "{CWD}/test/tap-testdir-index-eloop/a/peak",
  "{CWD}/test/tap-testdir-index-eloop/a/round",
  "{CWD}/test/tap-testdir-index-eloop/a/travel",
  "{CWD}/test/tap-testdir-index-eloop/a/up",
  "{CWD}/test/tap-testdir-index-eloop/aa",
  "{CWD}/test/tap-testdir-index-eloop/bigloop",
  "{CWD}/test/tap-testdir-index-eloop/dest",
  "{CWD}/test/tap-testdir-index-eloop/enoent",
  "{CWD}/test/tap-testdir-index-eloop/home",
  "{CWD}/test/tap-testdir-index-eloop/pivot",
  "{CWD}/test/tap-testdir-index-eloop/roundtrip",
]
`

exports[`test/index.ts TAP walking follow=false, filter=false, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=false, filter=false, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=false, filter=false, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=false, filter=false, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=false, filter=true, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=false, filter=true, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=false, filter=true, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`

exports[`test/index.ts TAP walking follow=false, filter=true, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`

exports[`test/index.ts TAP walking follow=true, filter=false, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=true, filter=false, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=true, filter=false, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=true, filter=false, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=true, filter=true, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=true, filter=true, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=true, filter=true, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`

exports[`test/index.ts TAP walking follow=true, filter=true, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/x/outside",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=false, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=false, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=false, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=false, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/d",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=true, walkFilter=false initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=true, walkFilter=false initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/d/cycle",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/g",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/f",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/e",
  "{CWD}/test/tap-testdir-index-walking/a/b/c/d/cycle",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=true, walkFilter=true initial walk, sync > must match snapshot 1`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`

exports[`test/index.ts TAP walking follow=undefined, filter=true, walkFilter=true initial walk, sync > must match snapshot 2`] = `
Set {
  "{CWD}/test/tap-testdir-index-walking/a",
  "{CWD}/test/tap-testdir-index-walking/a/x",
  "{CWD}/test/tap-testdir-index-walking/a/empty",
  "{CWD}/test/tap-testdir-index-walking/a/deeplink",
  "{CWD}/test/tap-testdir-index-walking/a/b",
  "{CWD}/test/tap-testdir-index-walking/a/b/c",
}
`
