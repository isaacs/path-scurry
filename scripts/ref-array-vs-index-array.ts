#!/usr/bin/env node --expose_gc --loader=ts-node/esm --no-warnings
// Say that we have K items in a tree, each of which has W subtree links.
//
// Is it better for each item to store an array of child item references, or to
// store all the items in a single array, and have each item store an array of
// numeric indexes?
//
// Conclusion is quite interesting!  Using an index array *seems* considerably
// faster, but on further investigation, that performance improvment mostly
// evaporates (or even flips) if you actually do anything with the children,
// like iterating over them calling some function.  In all such cases, it's
// slightly better for the items to have a direct reference to the array of
// items itself, rather than a reference to the Store object.
//
// So, the bottom line is, for directory walks that are just trivially building
// up a tree and throwing it away for a synthetic benchmark, an index array is
// much better, but if you're actually doing any relevant work, it's *maybe*
// worth doing, but much less of a slam dunk.

class ItemOne {
  children: ItemOne[] = []
  parent?: ItemOne
  getParent() {
    return this.parent
  }
  getChildren() {
    return this.children.slice()
  }
}
class StoreOne {
  root?: ItemOne
  length: number = 0
  drop() {
    this.root = undefined
    this.length = 0
  }
  addItem(parent?: ItemOne) {
    const i = new ItemOne()
    i.parent = parent
    if (!parent) this.root = i
    else parent.children.push(i)
    this.length++
    return i
  }
  getItem(i: ItemOne) {
    return i
  }
}

class ItemTwo {
  children: number[] = []
  parent?: number
  store: StoreTwo
  constructor(store: StoreTwo) {
    this.store = store
  }
  getParent() {
    return this.parent === undefined
      ? undefined
      : this.store.items[this.parent]
  }
  getChildren() {
    return this.children.slice()
  }
}
class StoreTwo {
  items: ItemTwo[] = []
  root?: number
  length: number = 0
  drop() {
    this.root = undefined
    this.items.length = 0
    this.length = 0
  }
  addItem(parent?: number) {
    const i = new ItemTwo(this)
    if (parent !== undefined) i.parent = parent
    else this.root = this.items.length
    const r = this.items.length
    this.items.push(i)
    this.length++
    return r
  }
  getItem(i: number) {
    return this.items[i]
  }
}

// same as 2, but a ref to the list is shared by the members,
// rather than items having a reference to the Store object.
class ItemThree {
  children: number[] = []
  parent?: number
  store: ItemThree[]
  constructor(store: ItemThree[]) {
    this.store = store
  }
  getParent() {
    return this.parent === undefined ? undefined : this.store[this.parent]
  }
  getChildren() {
    return this.children.slice()
  }
}
class StoreThree {
  items: ItemThree[] = []
  root?: number
  length: number = 0
  drop() {
    this.root = undefined
    this.items.length = 0
    this.length = 0
  }
  addItem(parent?: number) {
    const i = new ItemThree(this.items)
    if (parent !== undefined) i.parent = parent
    else this.root = this.items.length
    const r = this.items.length
    this.items.push(i)
    this.length++
    return r
  }
  getItem(i: number) {
    return this.items[i]
  }
}

const fill = (
  s: StoreOne | StoreTwo | StoreThree,
  operation: 'none' | 'iterate' | 'walk',
  count: number,
  width: number,
  parent: ItemOne | number
) => {
  //@ts-ignore
  const i = s.addItem(parent)
  // add w items, each with (count - 1)/w sub-children
  const c = count - 1
  const w = Math.min(c, width)
  for (let j = 0; j < w; j++) {
    const subc = j === 0 ? Math.ceil(c / w) : Math.floor(c / w)
    //@ts-ignore
    fill(s, operation, subc, width, s.addItem(i))
  }

  if (operation === 'iterate') {
    //@ts-ignore
    for (const c of s.getItem(i).getChildren()) {
      //@ts-ignore
      const item = s.getItem(c)
      if (item.parent !== i) {
        throw new Error('broken tree')
      }
    }
  }

  if (parent === undefined) {
    if (operation === 'walk') {
      //@ts-ignore
      function walk(i: any) {
        //@ts-ignore
        for (const c of s.getItem(i).getChildren()) {
          walk(c)
        }
      }
      walk(s)
    }
    if (s.length !== c) {
      throw new Error(`got=${s.length}, expect=${c}`)
    }
  }
  return i
}

const N = 100 // runs per iteration loop
const run = (
  Store: typeof StoreOne | typeof StoreTwo | typeof StoreThree,
  operation: 'none' | 'iterate' | 'walk',
  K: number,
  W: number
) => {
  let count = 0
  const start = performance.now()
  const e = start + 1000
  while (performance.now() < e) {
    const s = new Store()
    for (let i = 0; i < N; i++) {
      fill(s, operation, K - 1, W, s.addItem())
      s.drop()
      count += N
    }
  }
  const end = performance.now()
  const dur = end - start
  return count / dur
}

const cases: [
  string,
  typeof StoreOne | typeof StoreTwo | typeof StoreThree
][] = [
  ['item has ref array    ', StoreOne],
  ['store has number array', StoreTwo],
  ['item has number array ', StoreThree],
]

// [keys, width]
const KW: [number, number][] = [
  [100, 10],
  [1000, 10],
  [10_000, 10],
  [10_000, 10_000], // 1 root node with 9_999 children
  [100_000, 2],
  [100_000, 100],
]

console.log('putting K items in a tree of W width and then dropping')
console.log('scores in operations / ms, higher number is better')
for (const it of ['none', 'iterate', 'walk'] as const) {
  for (const [K, W] of KW) {
    console.log(`K=${K} W=${W} operation=${it}`)
    for (const [name, cls] of cases) {
      console.log(name, run(cls, it, K, W))
    }
  }
}

export {}
