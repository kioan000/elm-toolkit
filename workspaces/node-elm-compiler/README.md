# @elm-toolkit/node-elm-compiler

Runs the Elm compiler from Node. The package is a fork of
[`node-elm-compiler`](https://github.com/rtfeldman/node-elm-compiler) and
[`find-elm-dependencies`](https://github.com/noredink/find-elm-dependencies),
rewritten completely in TypeScript.

The original packages pull in old transitive dependencies, some of them with
known security problems. This one uses the Node standard library, and
`@elm-toolkit/cli-lib` from this toolkit.

## Two APIs

The package has two entry points, with the same function names and the same
options.

- `@elm-toolkit/node-elm-compiler/result-api` returns every failure as a
  `Result`, with a `CompileError` that a caller can inspect. Use it in new code.
- `@elm-toolkit/node-elm-compiler` is the API of the original packages, so code
  written for `node-elm-compiler` works with it. It throws or rejects when
  something fails. It is deprecated, and a later release will remove it.

The examples below use the new API.

## Compiling

`compileToString` returns the generated JavaScript. The compiler writes to a
temporary directory, which is removed afterwards. When the build fails, the
error holds the messages of Elm.

```ts
import { CliError } from '@elm-toolkit/cli-lib'
import { CompileError, compileToString } from '@elm-toolkit/node-elm-compiler/result-api'

const compiled = await compileToString('src/Main.elm', { debug: true })

switch (compiled.tag) {
  case 'Ok':
    console.log(`${compiled.value.length} characters of JavaScript`)
    break
  case 'Err':
    CliError.print('elm make', CompileError.toCliError(compiled.error))
}
```

`CompileError.toCliError` turns an error into a message for a person, with the
next step when there is one. A caller can also read `error.kind` and react to
one case, for example show the messages of a failed build in the browser. An
error that comes from an exception keeps the exception in `original`, with its
stack and its system code.

`compile` runs `elm make` as a child process and returns that process, for a
caller that wants the exit code or the streams. Both functions have a `Sync`
variant for scripts that can block.

An option that the package does not know is an error. A misspelled flag
therefore fails at once instead of being ignored.

## Checking without output

`dryCompile` checks that a program compiles, and writes nothing. Elm reads the
packages and reports every problem, as in a normal build. Use it in a test, a
commit hook or a CI step.

```ts
import { dryCompile } from '@elm-toolkit/node-elm-compiler/result-api'

const checked = await dryCompile('src/Main.elm', { cwd: 'frontend' })
// Ok, or Err with kind 'compileFailed' and the messages of Elm
```

## Finding what a module imports

`elm make` rebuilds from the entry file and does not say which files it read. A
bundler in watch mode needs that list, otherwise it misses a change in any file
except the entry. `findAllDependencies` reads the import section of each module
and follows every import that resolves to a file in a source directory of
`elm.json`.

```ts
import { findAllDependencies } from '@elm-toolkit/node-elm-compiler/result-api'

await findAllDependencies('/app/src/Page/Home.elm')
// Ok ['/app/src/Api.elm', '/app/src/Ui/Button.elm']
```

## Running Elm inside Node

`compileWorker` compiles a headless Elm program and starts it in the current
process. Tools written in Elm use it to exchange data with Node through ports.

## Moving to the new API

Each function of the old API has a function with the same name in
`./result-api`. Change the import, then handle both cases of the `Result`
where the old code caught an exception.

```diff
-import { compileToString } from '@elm-toolkit/node-elm-compiler'
+import { CliError } from '@elm-toolkit/cli-lib'
+import { CompileError, compileToString } from '@elm-toolkit/node-elm-compiler/result-api'

-try {
-  await writeFile('public/main.js', await compileToString('src/Main.elm', options))
-} catch (error) {
-  console.error(error)
-}
+const compiled = await compileToString('src/Main.elm', options)
+
+switch (compiled.tag) {
+  case 'Ok':
+    await writeFile('public/main.js', compiled.value)
+    break
+  case 'Err':
+    CliError.print('elm make', CompileError.toCliError(compiled.error))
+}
```

Some results changed shape:

- `compile` returns `Result<CompileError, ChildProcess>`. A compiler that cannot
  start is still an `'error'` event of the process, because it is known only
  after the call returns.
- `compileSync` returns the messages of the compiler, and a failed build is an
  `Err`. It no longer returns the object of `spawnSync`.
- `findAllDependencies` returns an `Err` for an entry file that cannot be read,
  instead of logging the problem and returning the dependencies it knew.
- `_prepareProcessArgs` is `prepareProcessArgs`.

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

Inside this monorepo, a script prints every message of the package, each error
as a command line tool prints it and every line that reaches the console. Run it
after a change to a message, to read the result:

```sh
corepack yarn workspace @elm-toolkit/node-elm-compiler messages
```

## Thanks

This package stands on the work of Richard Feldman and of everyone who
contributed to [`node-elm-compiler`](https://github.com/rtfeldman/node-elm-compiler)
and [`find-elm-dependencies`](https://github.com/noredink/find-elm-dependencies).
They designed the API, found and solved the hard cases of running the Elm
compiler from Node, and kept these tools working for the Elm community since 2015. This package is a full rewrite in TypeScript, but its old API keeps
theirs, with the shape of many of their functions and their error messages.
Thank you, sincerely.

The contributors are listed on GitHub:
[node-elm-compiler](https://github.com/rtfeldman/node-elm-compiler/graphs/contributors),
[find-elm-dependencies](https://github.com/noredink/find-elm-dependencies/graphs/contributors).

## License

BSD-3-Clause, copyright kioan000. The code that comes from the projects above
keeps the notice of its authors, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
