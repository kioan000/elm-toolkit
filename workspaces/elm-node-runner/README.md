# @elm-toolkit/elm-node-runner

Compiles Elm modules and runs them in Node, in one command. Use it for scripts
written in Elm: code generation, command line tools, steps of a build or of a
CI pipeline.

The package is a fork of [`elm-node`](https://github.com/joakin/elm-node). It
compiles through `@elm-toolkit/node-elm-compiler`, so it has no dependency
outside this repository, and it runs a TypeScript launcher directly, because
Node 24 can run TypeScript on its own.

## Running a program

Without a launcher, the runner starts the module called `Main`.

```sh
elm-node-runner --example-elm > src/Main.elm
elm-node-runner src/Main.elm
```

Two ports are connected. Whatever `Main` sends through a `log` port is printed.
Whatever it sends through an `eval` port runs as JavaScript, and that code can
reach the program as the global `app`, for example to send a value back to Elm.
`eval` runs any code it receives, so use it only with code that your program
writes itself.

## Running a program through a launcher

A launcher is a module whose default export is a function. The function receives
the `Elm` object, with one entry for each compiled module, and starts whatever it
needs with whatever flags and ports it needs.

```sh
elm-node-runner --example-elm > src/Main.elm
elm-node-runner --example-ts > src/main.ts
elm-node-runner --ts src/main.ts src/Main.elm
```

Node runs the launcher directly. A TypeScript launcher can therefore use only the
syntax that Node can strip, which excludes for example `enum`, and it must live
in your project, not in `node_modules`. A JavaScript launcher works as well.

## Options

`--optimize` builds with `elm make --optimize`. `--log-info` prints the compiler
command before it runs. `--help` lists every option.

The compiler runs in the current directory, so start the runner from your Elm
project or from a folder below it. The compiled code goes to a temporary
directory, which is removed once the program has started.

The command exits with code one when the build fails, when the launcher is
missing or has no function as its default export, and when there is no launcher
and no module called `Main`.

## Compatibility

The runner works with Elm 0.19.1 and Elm 0.19.2. The tests run Elm 0.19.2, from
the `elm` npm package. The `elm-version` in `elm.json` must match the compiler,
as the README of `@elm-toolkit/node-elm-compiler` explains.

## Requirements

Node 24, and an `elm` binary on the `PATH`. The package is compiled to `dist/`
and published as JavaScript.

## Thanks

The idea, the two ways to run a program, and the `log` and `eval` ports come from
[`elm-node`](https://github.com/joakin/elm-node) by Joakin, and from its
[contributors](https://github.com/joakin/elm-node/graphs/contributors). It is a
small tool that does one useful thing well, and this package only carries it
forward to TypeScript and to current Node. Thank you.

## License

BSD-3-Clause, copyright kioan000. The code that comes from `elm-node` keeps the
notice of its author, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
