# @elm-toolkit/webpack-elm-loader

A webpack loader for Elm. It compiles an Elm module into JavaScript. In
development mode it also adds hot module replacement to that JavaScript, so a
change to an Elm file updates the running page and keeps its state.

It is a fork of [`elm-webpack-loader`](https://github.com/elm-community/elm-webpack-loader),
with the work of [`elm-hot-webpack-loader`](https://github.com/klazuka/elm-hot-webpack-loader)
inside it. The compiler calls go through `@elm-toolkit/node-elm-compiler`, so
the loader has no other runtime dependency.

## Compiling Elm modules

```js
export default {
  module: {
    rules: [
      {
        test: /\.elm$/,
        exclude: [/elm-stuff/, /node_modules/],
        use: { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
      },
    ],
  },
}
```

Every option is optional.

| Option                 | Default                       | What it does                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`                  | the directory of the process  | The folder where Elm runs. Elm looks for `elm.json` there and in the folders above it, so set it when the Elm project is not at the root. In watch mode it also adds `elm.json` and the source directories to the watched files. |
| `debug`                | `true` in development mode    | Adds the Elm debugger, with `--debug`.                                                                                                                                                                                           |
| `optimize`             | `true` in production mode     | Builds with `--optimize`.                                                                                                                                                                                                        |
| `hotModuleReplacement` | `true` in development mode    | Adds hot module replacement to the output. The next section explains it.                                                                                                                                                         |
| `elmHome`              | the `ELM_HOME` of the process | The `ELM_HOME` of the compiler, relative to `cwd`. Without it, Elm uses the `ELM_HOME` of the environment, or `~/.elm`. When a tool patches the kernel packages in an Elm home of its own, give the loader the same folder.      |
| `files`                | the requested module          | A list of modules to compile into one bundle, instead of the module that webpack asks for.                                                                                                                                       |
| `pathToElm`            | `elm` on the `PATH`           | The Elm binary to run, for example `node_modules/.bin/elm`.                                                                                                                                                                      |
| `report`               | none                          | Passed to `--report`, for example `json`.                                                                                                                                                                                        |
| `runtimeOptions`       | none                          | Options for the runtime of the compiler, passed between `+RTS` and `-RTS`.                                                                                                                                                       |
| `verbose`              | `false`                       | Prints the command before it runs.                                                                                                                                                                                               |

The options can also come from a query string, for example
`@elm-toolkit/webpack-elm-loader?debug=false`.

In watch mode the loader reports every local module that the entry imports, so a
change in any of them starts a new build. With `cwd`, it also watches `elm.json`
and each source directory, so a new file is noticed too.

## Reloading in place

In development mode the loader adds hot module replacement to the compiled code.
The `hotModuleReplacement` option changes that default: `false` turns it off,
for example when another loader already adds it, and `true` turns it on in any
mode.

```js
export default (env, { mode }) => ({
  module: {
    rules: [
      {
        test: /\.elm$/,
        exclude: [/elm-stuff/, /node_modules/],
        use: {
          loader: '@elm-toolkit/webpack-elm-loader',
          // The same as the default; set it to false to turn hot module replacement off.
          options: { cwd: import.meta.dirname, hotModuleReplacement: mode === 'development' },
        },
      },
    ],
  },
  devServer: { hot: true },
})
```

The added code runs only when `module.hot` exists, which means under the
development server with hot module replacement enabled. In other development
builds it does nothing, and it only makes the bundle larger: about 18 KB, or
5 KB after gzip, against about 270 KB for a small program with the debugger.

The runtime in `hot/runtime.js` is the one from `elm-hot`, under its MIT
license. It is injected as text into the compiled Elm code, so it is not linted
or formatted with the rest of the repository.

An `elm/core` patched with [elm/core#1155](https://github.com/elm/core/pull/1155)
reloads itself: a development build offers `Elm.hot.reload()`. When that is
there, the loader passes each new version of the code to it, and the elm-hot
runtime stays off. Otherwise the elm-hot runtime does the work, as before.

## Compatibility

The loader works with Elm 0.19.1 and Elm 0.19.2. The tests run Elm 0.19.2, from
the `elm` npm package.

Hot module replacement depends on internal functions of the Elm runtime, which
it replaces to keep the state across a reload. Those functions have the same code
in 0.19.1 and 0.19.2. With 0.19.2, a `Browser.application` served by
webpack-dev-server takes a change to its Elm code in place: the view updates and
the model keeps its values.

The rules of `@elm-toolkit/node-elm-compiler` about versions apply here too: the
`elm-version` in `elm.json` must match the compiler that the loader runs.

## Requirements

Node 24, webpack 5, and Elm 0.19.1 or 0.19.2. The package is compiled to `dist/`
and published as JavaScript.

## Thanks

This loader exists because other people did the hard work first, and shared
it. Thank you to all of them.

- Richard Feldman created [`elm-webpack-loader`](https://github.com/elm-community/elm-webpack-loader),
  and the elm-community organization and its
  [contributors](https://github.com/elm-community/elm-webpack-loader/graphs/contributors)
  have maintained it for years. The Elm loader here is a fork of their code.
- Keith Lazuka wrote [`elm-hot`](https://github.com/klazuka/elm-hot) and
  [`elm-hot-webpack-loader`](https://github.com/klazuka/elm-hot-webpack-loader),
  with their [contributors](https://github.com/klazuka/elm-hot/graphs/contributors).
  Keeping the model of a running Elm program across a code change is a delicate
  piece of work, and the loader here reuses it almost unchanged.
- Flux Xu wrote [`elm-hot-loader`](https://github.com/fluxxu/elm-hot-loader),
  the work that `elm-hot` is based on.

## License

BSD-3-Clause, copyright kioan000. The code that comes from the projects above
keeps the notices of its authors, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
