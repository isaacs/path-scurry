const arr = new Array(100000).fill(0).map((_, i) => i)
function* syncIterate() {
  for (const i of arr) {
    yield i
  }
}
function syncCaller() {
  const arr = []
  for (const a of syncIterate()) {
    arr.push(a)
  }
}

async function* asyncIterate() {
  for await (const i of arr) {
    yield i
  }
}
async function asyncCaller() {
  const arr = []
  for await (const i of asyncIterate()) {
    arr.push(i)
  }
}

async function asyncCallerSync() {
  const arr = []
  for (const i of syncIterate()) {
    arr.push(i)
  }
}

const run = async fn => {
  const s = performance.now()
  const e = s + 1000
  let count = 0
  while (performance.now() < e) {
    await Promise.resolve(fn())
    count++
  }
  const dur = performance.now() - s
  return count / dur
}

const cases = [
  ['     async', asyncCaller],
  ['      sync', syncCaller],
  ['async sync', asyncCallerSync],
]

async function main() {
  for (const [name, fn] of cases) {
    console.log(name, await run(fn))
  }
}

main()
