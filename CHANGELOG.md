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

- **The patching routines take options and return a `Result`**

  `@elm-toolkit/cli-elm-kernel-patcher`: `prepareArgs` takes one options object
  instead of two arguments. It and `replaceKernelPackages` return a `Result`
  from `@elm-toolkit/cli-lib` instead of throwing. The value of `prepareArgs`
  has `PATCHES` instead of `CURRENT`, `PATCH_ARCHIVE`, `PATCH_DIR` and
  `USE_ARCHIVE`.

  **How to fix:**
  - Call `patchKernel`, which runs both steps and prints the outcome:

    ```diff
    -replaceKernelPackages(prepareArgs(true, 'frontend'))
    +patchKernel({ elmJsonFolder: 'frontend' })
    ```

  - Instead of catching an error, check the `tag` of the result; an `Err`
    holds a `CliError`, which `CliError.toString` turns into text.
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

- `@elm-toolkit/cli-lib`: `Maybe` and `Result`, with the functions of the
  modules of the same names in `elm/core` as methods, so that the steps read
  from top to bottom: `Result.fromAttempt(read).map(parse).mapError(describe)`.
  `Result.fromAttempt` turns an exception into an `Err`, and
  `Result.fromPromise` turns a rejected promise into one. `CliError` and
  `CliSuccess` describe the outcome of a command for a person, and their
  `print` functions show it the way every command of the toolkit does. A
  `CliError` can also carry the report of another program, such as a
  compiler, which is shown under "Details:" as that program wrote it.
- `@elm-toolkit/cli-elm-kernel-patcher`: `patchKernel`, which patches the Elm
  home and prints the progress and the outcome, as the command does.
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
- `@elm-toolkit/cli-elm-kernel-patcher`: the `archive init`, `archive build` and
  `archive check` commands, and the `./archive-builder` subpath. They keep a
  manifest of Git commits and the archive built from it in one folder,
  `elm-kernel-patcher/`, which `patches` accepts. A JSON schema of the manifest
  lets editors complete and check it.
- `@elm-toolkit/node-elm-compiler`: the `./result-api` subpath. It has the
  functions of the root, with the same names and options, but each one returns
  a `Result` with a `CompileError` instead of throwing.
  `CompileError.toCliError` turns that error into a message for a person. An
  error that comes from an exception keeps it in `original`.
- `@elm-toolkit/node-elm-compiler`: `dryCompile`, in `./result-api`. It checks
  that a program compiles, and writes no output.

### Changed

- `@elm-toolkit/cli-elm-kernel-patcher`: every outcome prints in one layout: a
  highlighted line that says what happened, then the sections "What happened:",
  "How to fix:" and "Next step:", each after a blank line. A suggested command
  keeps the options that were used. The settings of a patch run print as
  lines, and an error prints a stack trace only when it looks like a bug. A long
  line continues on the next line, within the width of the terminal, and a
  command between backticks stays on one line.
- `@elm-toolkit/cli-elm-kernel-patcher`: an archive is extracted into a
  temporary folder, not inside the installed package, so the patcher works when
  `node_modules` is read only.
- `@elm-toolkit/cli-elm-kernel-patcher`: each package in the bundled patches
  carries the `LICENSE` of its fork. The archive is now built from
  `lib/elm-kernel-patcher.json`, which names the commit of each package.
- `@elm-toolkit/node-elm-compiler`: the package now depends on
  `@elm-toolkit/cli-lib`.
- `@elm-toolkit/node-elm-compiler`: `compileWorker` no longer prints the
  messages of a failed build to the terminal. The error holds them instead.
- `@elm-toolkit/node-elm-compiler`: `compileToString` keeps the `processOpts`
  of the caller, such as `env`. Before, it replaced them.
- `@elm-toolkit/node-elm-compiler`: some messages of the deprecated API say
  more than before. Code that compares the text of an error must change:
  - `compile` and `compileToString` with sources that are neither a string nor
    a list throw a message that says so, instead of a message about the
    compiler.
  - A failed build of `compileToString` has only the problems that Elm
    reports, without the progress lines, also in the `verbose` log.
  - `compileWorker` names the compiler when it is not installed, instead of
    `Errored with exit code -2`.
  - `findAllDependencies` logs a file that it cannot read with a message that
    says what happened and how to fix it, instead of the raw error.
- `@elm-toolkit/webpack-elm-loader` and `@elm-toolkit/elm-node-runner` use the
  new API of `@elm-toolkit/node-elm-compiler`. When the loader cannot read the
  imports of a file, webpack shows a warning in the layout of the toolkit,
  instead of a line on the console.

### Deprecated

- `@elm-toolkit/node-elm-compiler`: the functions at the root of the package.
  They keep working as before, and a later release will remove them.

  **How to fix:** import the same function from `./result-api`, and read the
  `Result` instead of catching an exception. The README of the package lists
  the functions whose result changed shape.

  ```diff
  -import { compileToString } from '@elm-toolkit/node-elm-compiler'
  +import { compileToString } from '@elm-toolkit/node-elm-compiler/result-api'
  ```

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
