# @elm-toolkit/webpack-elm-loader

Two webpack loaders for Elm. The first compiles an Elm module into JavaScript.
The second adds hot module replacement to that JavaScript, so a change to an Elm
file updates the running page and keeps its state.

They are forks of [`elm-webpack-loader`](https://github.com/elm-community/elm-webpack-loader)
and [`elm-hot-webpack-loader`](https://github.com/klazuka/elm-hot-webpack-loader).
The compiler calls go through `@elm-toolkit/node-elm-compiler`, so the loaders
have no other runtime dependency.

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

The build uses `--debug` in development mode and `--optimize` in production
mode. The options can change both, and they accept every option of
`@elm-toolkit/node-elm-compiler`, for example `pathToElm`.

In watch mode the loader reports every local module that the entry imports, so a
change in any of them starts a new build. With `cwd`, it also watches `elm.json`
and each source directory, so a new file is noticed too.

## Reloading in place

Put the hot loader before the Elm loader. Webpack runs the loaders of a rule from
the last one to the first, so the hot loader receives the compiled code.

```js
use: [
  { loader: '@elm-toolkit/webpack-elm-loader/hot' },
  { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
]
```

The added code runs only when `module.hot` exists, which means under the
development server with hot module replacement enabled. Use the rule only in
development, because the added code makes the bundle much larger.

The runtime in `hot/runtime.js` is the one from `elm-hot`, under its MIT
license. It is injected as text into the compiled Elm code, so it is not linted
or formatted with the rest of the repository.

## Compatibility

Both loaders work with Elm 0.19.1 and Elm 0.19.2. The tests run Elm 0.19.2, from
the `elm` npm package.

The hot loader depends on internal functions of the Elm runtime, which it
replaces to keep the state across a reload. Those functions have the same code
in 0.19.1 and 0.19.2. With 0.19.2, a `Browser.application` served by
webpack-dev-server takes a change to its Elm code in place: the view updates and
the model keeps its values.

The rules of `@elm-toolkit/node-elm-compiler` about versions apply here too: the
`elm-version` in `elm.json` must match the compiler that the loader runs.

## Requirements

Node 24, webpack 5, and Elm 0.19.1 or 0.19.2. The package is compiled to `dist/`
and published as JavaScript.

## Thanks

These loaders exist because other people did the hard work first, and shared
it. Thank you to all of them.

- Richard Feldman created [`elm-webpack-loader`](https://github.com/elm-community/elm-webpack-loader),
  and the elm-community organization and its
  [contributors](https://github.com/elm-community/elm-webpack-loader/graphs/contributors)
  have maintained it for years. The Elm loader here is a fork of their code.
- Keith Lazuka wrote [`elm-hot`](https://github.com/klazuka/elm-hot) and
  [`elm-hot-webpack-loader`](https://github.com/klazuka/elm-hot-webpack-loader),
  with their [contributors](https://github.com/klazuka/elm-hot/graphs/contributors).
  Keeping the model of a running Elm program across a code change is a delicate
  piece of work, and the hot loader here reuses it almost unchanged.
- Flux Xu wrote [`elm-hot-loader`](https://github.com/fluxxu/elm-hot-loader),
  the work that `elm-hot` is based on.

## License

BSD-3-Clause, copyright kioan000. The code that comes from the projects above
keeps the notices of its authors, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
