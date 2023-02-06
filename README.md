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

## API

[Full TypeDoc API](https://isaacs.github.io/path-walker)

There are platform-specific classes exported, but for the most
part, the default `PathWalker` and `Path` exports are what you
most likely need, unless you are testing behavior for other
platforms.

Intended public API is documented here, but the full
documentation does include internal types, which should not be
accessed directly.

### Interface `PathWalkerOpts`

The type of the `options` argument passed to the `PathWalker`
constructor.

- `nocase`: Boolean indicating that file names should be compared
  case-insensitively. Defaults to `true` on darwin and win32
  implementations, `false` elsewhere.

  **Warning** Performing case-insensitive matching on a
  case-sensitive filesystem will result in occasionally very
  bizarre behavior. Performing case-sensitive matching on a
  case-insensitive filesystem may negatively impact performance.

- `childrenCacheSize`: Number of child entries to cache, in order
  to speed up `resolve()` and `readdir()` calls. Defaults to
  `16 * 1024` (ie, `16384`).

  Setting it to a higher value will run the risk of JS heap
  allocation errors on large directory trees. Setting it to `256`
  or smaller will significantly reduce the construction time and
  data consumption overhead, but with the downside of operations
  being slower on large directory trees. Setting it to `0` will
  mean that effectively no operations are cached, and this module
  will be roughly the same speed as `fs` for file system
  operations, and _much_ slower than `path.resolve()` for
  repeated path resolution.

### Interface `WalkOptions`

The options object that may be passed to all walk methods.

- `withFileTypes`: Boolean, default true. Indicates that `Path`
  objects should be returned. Set to `false` to get string paths
  instead.
- `follow`: Boolean, default false. Attempt to read directory
  entries from symbolic links. Otherwise, only actual directories
  are traversed. Regardless of this setting, a given target path
  will only ever be walked once, meaning that a symbolic link to
  a previously traversed directory will never be followed.

  Setting this imposes a slight performance penalty, because
  `readlink` must be called on all symbolic links encountered, in
  order to avoid infinite cycles.

- `filter`: Function `(entry: Path) => boolean`. If provided,
  will prevent the inclusion of any entry for which it returns a
  falsey value. This will not prevent directories from being
  traversed if they do not pass the filter, though it will
  prevent the directories themselves from being included in the
  results. By default, if no filter is provided, then all
  entries are included in the results.
- `walkFilter`: Function `(entry: Path) => boolean`. If
  provided, will prevent the traversal of any directory (or in
  the case of `follow:true` symbolic links to directories) for
  which the function returns false. This will not prevent the
  directories themselves from being included in the result set.
  Use `filter` for that.

Note that TypeScript return types will only be inferred properly
from static analysis if the `withFileTypes` option is omitted, or
a constant `true` or `false` value.

### Class `PathWalker`

The main interface. Defaults to an appropriate class based on
the current platform.

Use `PathWalkerWin32`, `PathWalkerDarwin`, or `PathWalkerPosix`
if implementation-specific behavior is desired.

#### `async pw.walk(entry?: string | Path, opts?: WalkOptions)`

Walk the directory tree according to the options provided,
resolving to an array of all entries found.

#### `pw.walkSync(entry?: string | Path, opts?: WalkOptions)`

Walk the directory tree according to the options provided,
returning an array of all entries found.

#### `pw.iterate(entry?: string | Path, opts?: WalkOptions)`

Iterate over the directory asynchronously, for use with `for
await of`. This is also the default async iterator method.

#### `pw.iterateSync(entry?: string | Path, opts?: WalkOptions)`

Iterate over the directory synchronously, for use with `for of`.
This is also the default sync iterator method.

#### `pw.stream(entry?: string | Path, opts?: WalkOptions)`

Return a [Minipass](http://npm.im/minipass) stream that emits
each entry or path string in the walk. Results are made
available asynchronously.

#### `pw.streamSync(entry?: string | Path, opts?: WalkOptions)`

Return a [Minipass](http://npm.im/minipass) stream that emits
each entry or path string in the walk. Results are made
available synchronously, meaning that the walk will complete in a
single tick if the stream is fully consumed.

#### `pw.cwd`

Path object representing the current working directory for the
PathWalker.

#### `pw.resolve(...paths: string[])`

Caching `path.resolve()`.

Significantly faster than `path.resolve()` if called repeatedly
with the same paths. Significantly slower otherwise, as it
builds out the cached Path entries.

To get a `Path` object resolved from the `PathWalker`, use
`pw.cwd.resolve(path)`. Note that `Path.resolve` only takes a
single string argument, not multiple.

#### `pw.basename(path: string | Path): string`

Return the basename of the provided string or Path.

#### `pw.dirname(path: string | Path): string`

Return the parent directory of the supplied string or Path.

#### `async pw.readdir(dir = pw.cwd, opts?: { withFileTypes: boolean })`

Read the directory and resolve to an array of strings if
`withFileTypes` is explicitly set to `false` or Path objects
otherwise.

Returns `[]` if no entries are found, or if any error occurs.

Note that TypeScript return types will only be inferred properly
from static analysis if the `withFileTypes` option is omitted, or
a constant `true` or `false` value.

#### `pw.readdirSync(dir = pw.cwd, opts?: { withFileTypes: boolean })`

Synchronous `pw.readdir()`

#### `async pw.readlink(link = pw.cwd, opts?: { withFileTypes: boolean })`

Call `fs.readlink` on the supplied string or Path object, and
return the result.

Returns `undefined` if any error occurs (for example, if the
argument is not a symbolic link), or a `Path` object if
`withFileTypes` is explicitly set to `true`, or a string
otherwise.

Note that TypeScript return types will only be inferred properly
from static analysis if the `withFileTypes` option is omitted, or
a constant `true` or `false` value.

#### `pw.readlinkSync(link = pw.cwd, opts?: { withFileTypes: boolean })`

Synchronous `pw.readlink()`

#### `async pw.lstat(entry = pw.cwd)`

Call `fs.lstat` on the supplied string or Path object, and fill
in as much information as possible, returning the updated `Path`
object.

Returns `undefined` if the entry does not exist, or if any error
is encountered.

Note that some `Stats` data (such as `ino`, `dev`, and `mode`) will
not be supplied. For those things, you'll need to call
`fs.lstat` yourself.

#### `pw.lstatSync(entry = pw.cwd)`

Synchronous `pw.lstat()`

### Class `Path` implements [fs.Dirent](https://nodejs.org/docs/latest/api/fs.html#class-fsdirent)

Object representing a given path on the filesystem, which may or
may not exist.

Note that the actual class in use will be either `PathWin32` or
`PathPosix`, depending on the implementation of `PathWalker` in
use. They differ in the separators used to split and join path
strings, and the handling of root paths.

In `PathPosix` implementations, paths are split and joined using
the `'/'` character, and `'/'` is the only root path ever in use.

In `PathWin32` implementations, paths are split using either
`'/'` or `'\\'` and joined using `'\\'`, and multiple roots may
be in use based on the drives and UNC paths encountered. UNC
paths such as `//?/C:/` that identify a drive letter, will be
treated as an alias for the same root entry as their associated
drive letter (in this case `'C:\\'`).

#### `path.name`

Name of this file system entry.

#### `path.fullpath()`

The fully resolved path to the entry.

#### `path.isFile()`, `path.isDirectory()`, etc.

Same as the identical `fs.Dirent.isX()` methods.

#### `path.isUnknown()`

Returns true if the path's type is unknown. Always returns true
when the path is known to not exist.

#### `path.resolve(p: string)`

Return a `Path` object associated with the provided path string
as resolved from the current Path object.

#### `async path.readdir()`

Return an array of `Path` objects found by reading the associated
path entry.

If path is not a directory, or if any error occurs, returns `[]`

#### `path.readdirSync()`

Synchronous `path.readdir()`

#### `async path.readlink()`

Return the `Path` object referenced by the `path` as a symbolic
link.

If the `path` is not a symbolic link, or any error occurs,
returns `undefined`.

#### `path.readlinkSync()`

Synchronous `path.readlink()`

#### `async path.lstat()`

Call `lstat` on the path object, and fill it in with details
determined.

If path does not exist, or any other error occurs, returns
`undefined`, and marks the path as "unknown" type.

#### `path.lstatSync()`

Synchronous `path.lstat()`
