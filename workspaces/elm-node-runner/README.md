# @elm-toolkit/elm-node-runner

Runs an Elm program in Node with one command. You write a headless program, a
`Platform.worker`, and the runner compiles it, starts it, and connects its
ports. Use it for scripts written in Elm: code generation, command line tools,
steps of a build or of a CI pipeline.

The package is a fork of [`elm-node`](https://github.com/joakin/elm-node). It
compiles through `@elm-toolkit/node-elm-compiler`, and it runs a TypeScript
launcher directly, because Node 24 can run TypeScript on its own.

## Getting started

Install the runner and Elm in an Elm project, the folder with `elm.json`:

```sh
npm install --save-dev @elm-toolkit/elm-node-runner elm
```

Write `src/Main.elm`, or let the runner write it with
`npx elm-node-runner --example-elm > src/Main.elm`:

```elm
port module Main exposing (main)


port log : String -> Cmd msg


main : Program () () ()
main =
    Platform.worker
        { init = \_ -> ( (), log "Hello from Elm" )
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
```

Run it:

```sh
npx elm-node-runner src/Main.elm
# Compiled in DEV mode. Follow the advice at https://elm-lang.org/0.19.3/optimize …
# Hello from Elm
```

The first line comes from Elm itself. `--optimize` removes it.

The runner calls `elm` by name, so run it through `npx` or from a script of
`package.json`, which put the `elm` of the project on the `PATH`.

## How the program talks to Node

Without a launcher, the runner starts the module called `Main`, without flags,
and connects two ports, when the program declares them:

- `port log : String -> Cmd msg` prints each value on the console.
- `port eval : String -> Cmd msg` runs each value as JavaScript. The code
  reaches the program as the global `app`, for example to send a value back
  through a port. It runs any code, so send it only code that the program
  writes itself.

## Running a program through a launcher

A launcher is a module whose default export receives the `Elm` object. Use one
when the program needs flags, other ports, or a module that is not called
`Main`. This launcher starts a code generator and writes what it sends:

```ts
// generate.ts
import { writeFileSync } from 'node:fs'

type Elm = {
  Generate: {
    init(options: { flags: string }): {
      ports: { output: { subscribe(listener: (text: string) => void): void } }
    }
  }
}

export default (Elm: Elm): void => {
  const app = Elm.Generate.init({ flags: 'Colors' })

  app.ports.output.subscribe((text) => writeFileSync('src/Colors.elm', text))
}
```

```sh
npx elm-node-runner --ts generate.ts src/Generate.elm
```

`Elm` has one entry for each compiled module. A module with a dot in its name
is nested: `Tools.Echo` is `Elm.Tools.Echo`. `--example-ts` prints a launcher
for the example `Main`.

Node runs the launcher as it is. A TypeScript launcher uses only syntax that
Node can strip, so no `enum`, and it lives in your project, not in
`node_modules`. A JavaScript launcher works as well.

## Options and errors

`--optimize` builds with `elm make --optimize`. `--help` lists every option.
`--verbose` prints, before the build, the binary that runs, the flags, the
working directory and the `ELM_HOME`. Use it when the build runs another Elm
than the one you expect.

Elm runs in the current directory, so start the runner from the Elm project or
from a folder below it. The messages of Elm stay hidden while it builds. When
the build succeeds, the command reports it before the program starts. When
something fails, the command prints one error and exits with code one. The
highlighted title of the error says in a few words what went wrong, such as
`Elm code does not compile`. The rest says what happened and how to fix it, with
the problems of Elm under "Details".

## Using the runner from code

`@elm-toolkit/elm-node-runner/runner` has the steps of the command as functions:
`compileProgram` compiles and loads the program, `startProgram` starts it with
a launcher or with `Main`, and `runElm` does both. Each one returns a `Result`,
with a `RunnerError`. `RunnerError.title` says in a few words what went wrong,
and `RunnerError.toCliError` describes the failure for a person.

```ts
import { CliError } from '@elm-toolkit/cli-lib'
import { RunnerError, runElm } from '@elm-toolkit/elm-node-runner/runner'

const runElmResult = await runElm({ elmFiles: ['src/Main.elm'], launcher: 'generate.ts' })

if (runElmResult.type_ === 'Err') {
  CliError.print(RunnerError.title(runElmResult.error), RunnerError.toCliError(runElmResult.error))
}
```

## Compatibility

The runner works with Elm 0.19.1, 0.19.2, and 0.19.3. CI runs the whole test
suite with each of them. The `elm-version` in `elm.json` must match the
compiler, as the README of `@elm-toolkit/node-elm-compiler` explains.

## Requirements

Node 24, and an `elm` binary on the `PATH`.

## Thanks

The idea, the two ways to run a program, and the `log` and `eval` ports come from
[`elm-node`](https://github.com/joakin/elm-node) by Joakin, and from its
[contributors](https://github.com/joakin/elm-node/graphs/contributors). It is a
small tool that does one useful thing well, and this package only carries it
forward to TypeScript and to current Node. Thank you.

## License

BSD-3-Clause, copyright kioan000. The code that comes from `elm-node` keeps the
notice of its author, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
