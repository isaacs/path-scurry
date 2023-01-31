# path-walker

Extremely high performant lowlevel utility for building tools
that walk the file system, minimizing filesystem and path string
munging operations to the greatest degree possible.

## Ugh, yet another file traversal thing on npm?

Yes. None of the existing ones gave me exactly what I wanted.

## Well what is it you wanted?

While working on [glob](http://npm.im/glob), I found that I
needed a module to very efficiently manage the traversal over a
folder tree, such that:

1. No `readdir()` or `stat()` would ever be called on the same
   file or directory more than one time.
2. No `readdir()` calls would be made if we can be reasonably
   sure that the path is not a directory. (Ie, a previous
   `readdir()` or `stat()` covered the path, and
   `ent.isDirectory()` is false.)
3. `path.resolve()`, `dirname()`, `basename()`, and other
   string-parsing/munging operations are be minimized.  This
   means it has to track "provisional" child nodes that may not
   exist (and if we find that they _don't_ exist, store that
   information as well).
4. The results are _not_ represented as a stream, and do not
   require any sort of filter or decision functions. Every step
   should be 100% deliberate.
5. Despite the large amount of information being cached, avoid
   creating a lot of objects that need to be garbage collected.
   This means using an approach based on uint32 arrays of raw
   integer data, bitshifting, pointers, and so on.

Note that while these features make it a good fit where
performance is the primary concern, that last two make it rather
inconvenient for many higher-level use cases.

## USAGE

```js
// hybrid module, load with either method
import { PathWalker } from 'path-walker'
// or:
const { PathWalker } = require('path-walker')

// give it a starting path initially
// then call .child(part) to go to the next
// step in the walk.

// very simple example, say we want to find and
// delete all the .DS_Store files in a given path
import { unlink } from 'fs/promises'
const walk = async (entry: Pointer) => {
  const promises:Promise<any> = []
  // readdir doesn't throw ENOTDIR on known non-directories,
  // it just doesn't yield any entries, to save stack trace
  // creation costs.
  // Items are returned in arbitrary unsorted order
  for await (const child of pw.readdir(entry)) {
    // each child is a uint32 pointer in a PointerSet
    const basename = pw.basename(child)
    if (basename === '.DS_Store' && pw.isFile(child)) {
      promises.push(unlink(pw.fullpath(child)))
    } else {
      promises.push(pw.walk(child, walk))
    }
  }
  return Promise.all(promises)
}
const pw = new PathWalker(process.cwd())
walk(pw.start).then(() => {
  console.log('all .DS_Store files removed')
})

const pw2 = new PathWalker('/a/b/c')
const relativeDir = pw2.resolve('../x') // pointer to entry for '/a/b/x'
const relative2 = pw2.resolve('/a/b/d/../x') // same path, same pointer
```
