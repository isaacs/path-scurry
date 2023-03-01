# churnge loog

## 1.6

- Allow overriding the default fs with custom methods
- make Stats fields available after lstat()
- add depth() method
- add declarationMap to tsconfig

## 1.5

- support file:// url as cwd
- handle in-flight readdirCB, readdir

## 1.4

- add isNamed() for case and unicode normalization

## 1.3

- expose calledReaddir, isENOENT, and canReadlink methods

## 1.2.0

- Add Path.relative(), PathScurry.relative()

## 1.1

- Properly limit return value types based on withFileTypes
- Benchmarks take too long for GHA, sadly
- correct benchmark link, provide output while generating
- run benchmarks as part of docs build
- Support calling blah({opts}) to operate on cwd

## 1.0.0

- Initial version
