# @elm-toolkit/webpack-elm-kernel-patcher-plugin

A webpack plugin that applies the Elm kernel patches of
`@elm-toolkit/cli-elm-kernel-patcher` before webpack compiles any Elm module.

The Elm compiler reads package sources from `ELM_HOME`, so the patched kernel
must be in place before the Elm loader runs. The plugin calls the patcher in the
`initialize` hook of webpack, in the same process, so no command has to run
before the build. The hook runs once, and a rebuild in watch mode does not patch
again.

The patched `elm/core` reloads itself in development builds, and the hot loader
of `@elm-toolkit/webpack-elm-loader` then uses it instead of its own runtime. A
project that does not use this plugin keeps the official kernel, and hot
reloading still works through that runtime.

## Usage

```js
import ElmKernelPatcherPlugin from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'

export default {
  plugins: [
    new ElmKernelPatcherPlugin({
      isEnabled: (compiler) => compiler.options.mode === 'development',
    }),
  ],
}
```

`isEnabled` turns the plugin on. It is a boolean, or a function that receives
the webpack compiler and decides when webpack starts, once the configuration,
mode included, is complete. When it is `false`, the plugin does nothing.

`elmHome` names the Elm home to patch, relative to the folder that holds
`elm.json`. Without it, the plugin patches the `ELM_HOME` of the environment,
or `~/.elm` when that is not set. The next section explains when to set it.

`patches` names patches of your own: a `.tar.gz` archive of a `patches/`
folder, or that folder itself, relative to the folder that holds `elm.json`.
Without it, the patches come from the archive inside the patcher package. The
README of `@elm-toolkit/cli-elm-kernel-patcher` describes the layout.

`elmJsonFolder` is the folder that holds `elm.json`. It defaults to `INIT_CWD`,
which npm and yarn set when they run a script, and falls back to the current
directory. The README of
`@elm-toolkit/cli-elm-kernel-patcher` describes what it changes and when it
refuses to run.

When patching fails, the plugin prints a short message and passes the error to
webpack, which stops the build.

## Choosing Elm home

The patcher replaces packages inside `ELM_HOME`, and they stay there. Without
`ELM_HOME`, Elm uses `~/.elm`, which every Elm project on the machine shares, so
every later build on that machine would compile against the patched kernel:
other projects, and production builds that do not use this plugin, too.

A folder as `elmHome`, relative to the folder that holds `elm.json`, keeps the
patched packages to this project. `elm-home/elm-stuff` is a good choice, because
tools such as elm-format ignore any folder with that name. The Elm compiler of
the build must then use the same folder as its `ELM_HOME`.

The project's own `elm-stuff/<version>` folder also keeps compiled code of the
packages, and Elm reuses it even after `ELM_HOME` changes. Remove that folder
before a production build on a machine where the plugin has run. A build on a
clean checkout, as in CI, does not need this.

## Requirements

Node 24, webpack 5, and an Elm project on a version that the patcher supports,
today 0.19.1 or 0.19.2. On another version the plugin stops the build before
anything changes. The package is compiled to `dist/` and published as
JavaScript.

## Thanks

The patches and the way to apply them come from
[lydell](https://github.com/lydell), through `@elm-toolkit/cli-elm-kernel-patcher`.
Its README tells the full story and credits every source.

## License

BSD-3-Clause, copyright kioan000.
