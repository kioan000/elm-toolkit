# Changelog

Every package in this repository shares one version, so one changelog covers
all of them. Each entry names the package it changes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
A version with a hyphen, such as `0.1.0-alpha.2`, is a pre-release.

## [Unreleased]

### Breaking changes

- **The `./hot` subpath is removed**

  `@elm-toolkit/webpack-elm-loader`: the hot loader no longer exists. The Elm
  loader adds hot module replacement itself, in development mode.

  **How to fix:** remove the hot loader from `use`.

  ```diff
  -use: [
  -  { loader: '@elm-toolkit/webpack-elm-loader/hot' },
  -  { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
  -]
  +use: { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } }
  ```

- **Development builds get hot module replacement by default**

  `@elm-toolkit/webpack-elm-loader`: in development mode the output now
  contains the hot reloading code, also without the hot loader in the
  configuration.

  **How to fix:** nothing, in most projects, because the code runs only under
  the development server. To keep the old output, set
  `hotModuleReplacement: false` in the options of the loader.

- **The plugin is now `ElmKernelPatcherPlugin`**

  `@elm-toolkit/webpack-elm-kernel-patcher-plugin`: the class is now
  `ElmKernelPatcherPlugin`, and its options type is
  `ElmKernelPatcherPluginOptions`. The class is the default export, so an
  `import` of it keeps working under any local name.

  **How to fix:** change an import of the options type.

  ```diff
  -import type { ElmKernelReplacementPluginOptions } from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'
  +import type { ElmKernelPatcherPluginOptions } from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'
  ```

- **`useArchive` is removed**

  `@elm-toolkit/cli-elm-kernel-patcher` and the plugin: `useArchive` and
  `--useArchive` no longer exist. Patches of your own go in `patches`.

  **How to fix:**
  - With `useArchive: true`, the default, remove the option. The bundled
    archive is used, as before.
  - With `useArchive: false`, the patcher read a `patches/` folder inside its
    installed package. Move that folder into the project and name it in
    `patches`, relative to the folder that holds `elm.json`:

    ```diff
    -new ElmKernelReplacementPlugin({ isEnabled: true, useArchive: false })
    +new ElmKernelPatcherPlugin({ isEnabled: true, patches: 'kernel/patches' })
    ```

  - On the command line, `--useArchive false` becomes
    `--patches kernel/patches`.

- **`prepareArgs` takes an options object**

  `@elm-toolkit/cli-elm-kernel-patcher`: `prepareArgs` takes one options object
  instead of two arguments. The value it returns has `PATCHES` instead of
  `CURRENT`, `PATCH_ARCHIVE`, `PATCH_DIR` and `USE_ARCHIVE`.

  **How to fix:**
  - Pass the project folder by name, and drop the first argument:

    ```diff
    -replaceKernelPackages(prepareArgs(true, 'frontend'))
    +replaceKernelPackages(prepareArgs({ elmJsonFolder: 'frontend' }))
    ```

  - With `false` as the first argument, also add `patches`, as described above.
  - Code that reads the returned paths reads `PATCHES` instead.

- **The bundled patches include `elm/core`**

  `@elm-toolkit/cli-elm-kernel-patcher`: the bundled patches now include
  `elm/core` from [elm/core#1155](https://github.com/elm/core/pull/1155), with
  matching `elm/browser` and `elm/virtual-dom`. Every build that compiles
  against the patched Elm home uses them, also in production. The hot reloading
  code is not in a build made with `--optimize`.

  **How to fix:** nothing, when the patched kernel may reach production builds.
  To keep the official kernel there:
  - patch only in development, into an Elm home of its own;
  - compile from that Elm home only in development;
  - before a production build on a machine where the plugin has run, remove the
    `elm-stuff/<version>` folder of the project, because Elm reuses the
    compiled package code that it keeps there.

  ```js
  export default (env, { mode }) => {
    const elmHome = mode === 'development' ? 'elm-home/elm-stuff' : undefined

    return {
      module: {
        rules: [
          {
            test: /\.elm$/,
            use: {
              loader: '@elm-toolkit/webpack-elm-loader',
              options: { cwd: import.meta.dirname, elmHome },
            },
          },
        ],
      },
      plugins: [
        new ElmKernelPatcherPlugin({
          elmHome,
          isEnabled: mode === 'development',
        }),
      ],
    }
  }
  ```

### Added

- `@elm-toolkit/cli-elm-kernel-patcher` and the plugin: `patches` takes a
  `.tar.gz` archive of a `patches/` folder, or the folder itself. Such patches
  skip the check of the Elm version, and a wrong layout stops with the expected
  one. Patches without `elm/virtual-dom` make Elm compile everything again at
  each start.
- `@elm-toolkit/cli-elm-kernel-patcher`, the plugin and
  `@elm-toolkit/webpack-elm-loader`: an optional `elmHome`. Without it, each one
  uses the `ELM_HOME` of the environment, or `~/.elm`.
- `@elm-toolkit/webpack-elm-kernel-patcher-plugin`: `isEnabled` also takes a
  function that receives the webpack compiler.
- `@elm-toolkit/webpack-elm-loader`: hot module replacement uses
  `Elm.hot.reload()` when the kernel offers it.
- `@elm-toolkit/webpack-elm-loader`: the `hotModuleReplacement` option, which
  defaults to the development mode of webpack.

### Changed

- `@elm-toolkit/cli-elm-kernel-patcher`: an archive is extracted into a
  temporary folder, not inside the installed package, so the patcher works when
  `node_modules` is read only.

## [0.1.0-alpha.2] - 2026-10-02

### Added

- `@elm-toolkit/cli-elm-kernel-patcher`: the patches also work with Elm 0.19.2.
  A project on any other Elm version is refused before any file changes.

## [0.1.0-alpha.1] - 2026-10-02

The first release. The packages are attached to the GitHub release as archives,
and they are not on the npm registry.

### Added

- `@elm-toolkit/node-elm-compiler`: a wrapper around `elm make` with no runtime
  dependency. It compiles to a file or to a string, lists the local modules that
  an Elm file imports, and refuses an option that it does not know.
- `@elm-toolkit/webpack-elm-loader`: a webpack loader that compiles Elm modules,
  forked from `elm-webpack-loader`. In watch mode it watches every imported
  module, and with `cwd` also `elm.json` and the source directories. The `./hot`
  subpath adds hot module replacement, forked from `elm-hot-webpack-loader`.
- `@elm-toolkit/cli-elm-kernel-patcher`: a command that replaces `elm/browser`,
  `elm/html` and `elm/virtual-dom` in `ELM_HOME` with the patched forks by
  lydell, after it checks that the versions in `elm.json` match. The same code
  is available as a library on the `./patcher` subpath.
- `@elm-toolkit/webpack-elm-kernel-patcher-plugin`: a webpack plugin that runs
  the patcher once, before webpack compiles any Elm module.
- `@elm-toolkit/elm-node-runner`: a command that runs an Elm program in Node.
- `@elm-toolkit/cli-lib`: the helpers that the command line tools share.

[Unreleased]: https://github.com/kioan000/elm-toolkit/compare/v0.1.0-alpha.2...HEAD
[0.1.0-alpha.2]: https://github.com/kioan000/elm-toolkit/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/kioan000/elm-toolkit/releases/tag/v0.1.0-alpha.1
