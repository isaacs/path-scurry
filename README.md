# path-walker

Extremely high performant utility for building tools that read
the file system, minimizing filesystem and path string munging
operations to the greatest degree possible.

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
   string-parsing/munging operations are be minimized. This
   means it has to track "provisional" child nodes that may not
   exist (and if we find that they _don't_ exist, store that
   information as well, so we don't have to ever check again).
4. The results are _not_ represented as a stream, and do not
   require any sort of filter or decision functions. Every step
   should be 100% deliberate, just like using the normal `fs`
   operations.
5. It's more important to prevent excess syscalls than to be up
   to date, but it should be smart enough to know what it
   _doesn't_ know, and go get it seamlessly when requested.
6. Do not blow up the JS heap allocation if operating on a
   directory with a huge number of entries.

## USAGE

```ts
// hybrid module, load with either method
import { PathWalker, Path } from 'path-walker'
// or:
const { PathWalker, Path } = require('path-walker')

// very simple example, say we want to find and
// delete all the .DS_Store files in a given path
// note that the API is very similar to just a
// naive walk with fs.readdir()
import { unlink } from 'fs/promises'
const walk = async (entry: Path) => {
  const promises: Promise<any> = []
  // readdir doesn't throw on non-directories, it just doesn't
  // return any entries, to save stack trace costs.
  // Items are returned in arbitrary unsorted order
  for (const child of await pw.readdir(entry)) {
    // each child is a uint32 pointer in a PointerSet
    if (child.name === '.DS_Store' && child.isFile()) {
      // could also do pw.resolve(entry, child.name),
      // just like fs.readdir walking, but .fullpath is
      // a *slightly* more efficient shorthand.
      promises.push(unlink(child.fullpath()))
    } else {
      promises.push(walk(child))
    }
  }
  return Promise.all(promises)
}
const pw = new PathWalker(process.cwd())
walk(pw.cwd).then(() => {
  console.log('all .DS_Store files removed')
})

const pw2 = new PathWalker('/a/b/c')
const relativeDir = pw2.cwd.resolve('../x') // pointer to entry for '/a/b/x'
const relative2 = pw2.cwd.resolve('/a/b/d/../x') // same path, same pointer
```
