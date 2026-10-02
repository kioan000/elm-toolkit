# @elm-toolkit/node-elm-compiler

Runs the Elm compiler from Node. The package is a fork of
[`node-elm-compiler`](https://github.com/rtfeldman/node-elm-compiler) and
[`find-elm-dependencies`](https://github.com/noredink/find-elm-dependencies),
rewritten completely in TypeScript with no runtime dependencies. It keeps their
public API, so code written for `node-elm-compiler` works with it.

The original packages pull in old transitive dependencies, some of them with
known security problems. This one uses only the Node standard library.

## Compiling

`compile` runs `elm make` as a child process and returns that process. The
options become command line flags.

```ts
import { compile } from '@elm-toolkit/node-elm-compiler'

compile(['src/Main.elm'], { output: 'dist/main.js', optimize: true }).on('close', (exitCode) => {
  console.log(exitCode === 0 ? 'built' : 'failed')
})
```

`compileToString` returns the generated JavaScript instead of writing it where
the caller chooses. The compiler writes to a temporary directory, which is
removed afterwards.

```ts
import { compileToString } from '@elm-toolkit/node-elm-compiler'

const javascript = await compileToString('src/Main.elm', { debug: true })
```

Both functions have a `Sync` variant for scripts that can block.

An option that the package does not know raises an error. A misspelled flag
therefore fails at once instead of being ignored.

## Finding what a module imports

`elm make` rebuilds from the entry file and does not say which files it read. A
bundler in watch mode needs that list, otherwise it misses a change in any file
except the entry. `findAllDependencies` reads the import section of each module
and follows every import that resolves to a file in a source directory of
`elm.json`.

```ts
import { findAllDependencies } from '@elm-toolkit/node-elm-compiler'

await findAllDependencies('/app/src/Page/Home.elm')
// ['/app/src/Api.elm', '/app/src/Ui/Button.elm']
```

## Running Elm inside Node

`compileWorker` compiles a headless Elm program and starts it in the current
process. Tools written in Elm use it to exchange data with Node through ports.

## Compatibility

The package works with Elm 0.19.1 and Elm 0.19.2. The tests run Elm 0.19.2, from
the `elm` npm package.

The compiler version and the project must agree. Elm 0.19.2 refuses an
application whose `elm.json` declares `"elm-version": "0.19.1"`, and the other
way round. Each version also keeps its own package cache, in `ELM_HOME/0.19.1`
and `ELM_HOME/0.19.2`, so the first build after a change of version downloads the
packages again.

## Requirements

Node 24, and an `elm` binary on the `PATH` or given with `pathToElm`. The package
is compiled to `dist/` and published as JavaScript.

## Thanks

This package stands on the work of Richard Feldman and of everyone who
contributed to [`node-elm-compiler`](https://github.com/rtfeldman/node-elm-compiler)
and [`find-elm-dependencies`](https://github.com/noredink/find-elm-dependencies).
They designed the API, found and solved the hard cases of running the Elm
compiler from Node, and kept these tools working for the Elm community since 2015. This package is a full rewrite in TypeScript, without dependencies, but
it keeps their API, the shape of many of their functions, and their error
messages. Thank you, sincerely.

The contributors are listed on GitHub:
[node-elm-compiler](https://github.com/rtfeldman/node-elm-compiler/graphs/contributors),
[find-elm-dependencies](https://github.com/noredink/find-elm-dependencies/graphs/contributors).

## License

BSD-3-Clause, copyright kioan000. The code that comes from the projects above
keeps the notice of its authors, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
