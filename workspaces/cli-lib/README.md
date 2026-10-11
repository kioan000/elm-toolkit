# @elm-toolkit/cli-lib

The small library that every tool of elm-toolkit is built on. If you write a
command line program or a build tool in TypeScript, you can use it too: it
brings `Maybe` and `Result` from `elm/core`, a way to describe an outcome for a
person, and a few helpers that a command line program needs. It has no runtime
dependencies.

## Maybe and Result

`Maybe` and `Result` work as in `elm/core`, with the functions of those modules
as methods, so a chain of steps reads from top to bottom. A step that can fail
returns a `Result` instead of throwing, and you handle the error where it makes
sense.

```ts
import { Result } from '@elm-toolkit/cli-lib'

const versionResult = Result.fromAttempt(() => readFileSync('elm.json', 'utf8'))
  .map((text) => JSON.parse(text) as { 'elm-version': string })
  .map((elmJson) => elmJson['elm-version'])

versionResult.withDefault('0.19.1') // '0.19.3'
```

`Result.fromAttempt` turns an exception into an `Err`, and `Result.fromPromise`
does the same for a rejected promise. A value has a `type_`, `'Ok'` or `'Err'`,
so a `switch` reaches both cases, and TypeScript knows the fields of each one.

## Messages for people

`CliError` describes a failure the way every command of the toolkit prints it:
a highlighted title that says what broke, a summary with the detail, and the
sections below.

```ts
import { CliError } from '@elm-toolkit/cli-lib'

CliError.print(
  'manifest not found',
  CliError.create({
    solution: 'Create it with `cli-elm-kernel-patcher archive init`.',
    summary: 'elm-kernel-patcher/elm-kernel-patcher.json',
  })
)
// ERROR:manifest not found elm-kernel-patcher/elm-kernel-patcher.json
//
//     How to fix:
//         Create it with `cli-elm-kernel-patcher archive init`.
```

The summary continues the sentence of the title, so `print` writes its first
letter in lower case, unless it starts with a proper noun such as Elm.
`continuingSentence` applies the same rule to your own text, and
`splitFirstLine` splits the message of an exception into a summary and the lines
below it. A `CliError` can also carry the report of another program, such as a
compiler, which `print` shows under "Details:" as that program wrote it.
`CliError.toString` gives the same text without colors, for an `Error` that
stops a tool such as webpack.

`CliSuccess` does the same for a command that worked, with "What happened:" and
"Next step:".

For a single line of progress, `prettyInfo`, `prettyWarn`, and `prettyError`
print a highlighted title followed by any values:

```ts
import { prettyInfo } from '@elm-toolkit/cli-lib'

prettyInfo('> Running:', 'Patching the Elm home')
```

## Running another program

`spawnCommand` runs another program, and connects its input and output to the
current process, so its output appears as if your tool had printed it. It
returns a promise, which resolves when the program exits with code zero, and
rejects otherwise.

```ts
import { spawnCommand } from '@elm-toolkit/cli-lib'

await spawnCommand('Building', 'yarn', ['webpack', '--mode', 'production'])
```

## Questions a module asks about itself

These functions take the `import.meta.url` of the calling module, because the
answer is about that module, not about this library.

`isEntryPoint` tells whether Node started the module, or whether something
imported it. A command line program uses it to parse its arguments only when it
runs as a command:

```ts
import { isEntryPoint } from '@elm-toolkit/cli-lib'

if (isEntryPoint(import.meta.url)) {
  program.parse()
}
```

`readPackageJson` finds the `package.json` of the package. Compiled code sits
one folder below its source, so no fixed relative path works from both:

```ts
import { readPackageJson } from '@elm-toolkit/cli-lib'

program.version(readPackageJson(import.meta.url).version)
```

`findElmBinary` finds the `elm` executable that your package depends on, so
your tests and scripts run the compiler that you pin, and never a global `elm`.
Set `ELM_TEST_BINARY` to run another one, for example to test with an older Elm:

```ts
import { findElmBinary } from '@elm-toolkit/cli-lib'

await compileToString('src/Main.elm', { pathToElm: findElmBinary(import.meta.url) })
```

## Requirements

Node 24.

## License

BSD-3-Clause, copyright kioan000.
