# @elm-toolkit/webpack-elm-kernel-patcher-plugin

A webpack plugin that applies the Elm kernel patches of
`@elm-toolkit/cli-elm-kernel-patcher` before webpack compiles any Elm module.

The Elm compiler reads package sources from `ELM_HOME`, so the patched kernel
must be in place before the Elm loader runs. The plugin calls the patcher in the
`initialize` hook of webpack, in the same process, so no command has to run
before the build. The hook runs once, and a rebuild in watch mode does not patch
again.

## Usage

```js
import ElmKernelReplacementPlugin from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'

export default {
  plugins: [new ElmKernelReplacementPlugin({ isEnabled: true })],
}
```

`isEnabled` turns the plugin on. When it is false, the plugin does nothing.

`useArchive` defaults to `true`, and then the patches come from the archive
inside the patcher package. Set it to `false` to use a `patches/` directory of
your own.

`elmJsonFolder` is the folder that holds `elm.json`. It defaults to `INIT_CWD`,
which npm and yarn set when they run a script, and falls back to the current
directory. The README of
`@elm-toolkit/cli-elm-kernel-patcher` describes what it changes and when it
refuses to run.

When patching fails, the plugin prints a short message and passes the error to
webpack, which stops the build.

## Requirements

Node 24, webpack 5, and an Elm 0.19.1 project. The patches and the folders that
the patcher writes are those of Elm 0.19.1, so the plugin does not support Elm
0.19.2. The package is compiled to `dist/` and published as
JavaScript.

## Thanks

The patches and the way to apply them come from
[lydell](https://github.com/lydell), through `@elm-toolkit/cli-elm-kernel-patcher`.
Its README tells the full story and credits every source.

## License

BSD-3-Clause, copyright kioan000.
