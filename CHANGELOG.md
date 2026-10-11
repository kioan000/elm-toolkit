# Changelog

Every package in this repository shares one version, so one changelog covers
all of them. Each entry names the package it changes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
A version with a hyphen, such as `0.1.0-alpha.2`, is a pre-release.

## [Unreleased]

## [0.1.0-alpha.3] - 2026-10-11

### What's new

This alpha is about two things: a better API for people who build tools on top
of Elm, and hot reloading that keeps the state of your app, thanks to the
kernel patches of [lydell](https://github.com/lydell).
Some APIs change, and [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3) shows what to edit in your
project.

**For tool authors: a Result API.** `node-elm-compiler` and `elm-node-runner`
now have an API that never throws. Every function returns a `Result`, and every
error tells you what happened: the output of Elm when the code does not
compile, the system error when the compiler is missing, the exception when a
program crashes while it loads. Handle the cases you care about, and print the
rest.

```ts
const result = await dryCompile('src/Main.elm', { cwd: 'frontend' })

if (result.type_ === 'Err' && result.error.type_ === 'CompileFailed') {
  showInTheBrowser(result.error.output)
}
```

You can also split compiling from running: `compileRunnableProgram` gives you
the compiled program, and you decide when to load it, which module to start,
and with which flags.

**Hot reloading that keeps your state.** Save an Elm file, and the running page
updates in place. With the patched `elm/core` of lydell, from
[elm/core#1155](https://github.com/elm/core/pull/1155), which now ships with the
kernel patcher, a `Browser.application` keeps its model: you stay on the same
screen, with the same data. The loader enables this in development by itself,
and the separate hot loader, `./hot`, is removed: [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3) shows the
change in your webpack configuration.

**Kernel patches from any Git commit.** A fix in the kernel code of
`elm/core`, `elm/browser`, or `elm/virtual-dom` reaches your project only with a
new release of that package. The kernel patcher now builds patches from forks
that you choose: name a package, a Git repository, and a commit in a small
manifest, and `archive build` packs them into an archive, with the `LICENSE` of
each fork. Give the folder to the plugin, and every build uses your patches.
Your editor checks the manifest against its JSON schema, and `archive check`
tells CI when the archive no longer matches the manifest. The bundled patches
are built the same way.

```sh
cli-elm-kernel-patcher archive init    # start from the manifest of the bundled patches
cli-elm-kernel-patcher archive build   # fetch the commits and write patches.tar.gz
cli-elm-kernel-patcher --patches elm-kernel-patcher
```

**Errors you can read.** Every command now says what broke in a few words, then
what happened and how to fix it:

```
ERROR:Elm compiler not found "elm"

    How to fix:
        Install Elm in the project with `npm install --save-dev elm`, …
```

**Also in this release**

- Keep the patched kernel out of production, with the new `elmHome` option.
- Elm 0.19.3 works, and CI tests every package with 0.19.1, 0.19.2, and 0.19.3.
- `cli-lib` exposes the `Maybe`, `Result`, and `CliError` that the toolkit
  uses.

### All changes

Here is every change of this release, package by package. The packages that
most projects use come first.

#### webpack-elm-loader

**Breaking changes**

- `./hot` is removed, and development builds get hot module replacement by
  default. See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

**Added**

- `hotModuleReplacement`, on by default when webpack runs in development mode.
- Hot module replacement uses `Elm.hot.reload()` when the kernel offers it, as
  the patched `elm/core` does. That is what keeps the state of your app.
- `elmHome`, to compile against an Elm home of your choice. Without it, the
  loader uses `ELM_HOME`, or `~/.elm`.

**Changed**

- When the loader cannot read the imports of a file, you get a webpack warning
  that says what went wrong, instead of a line on the console.

#### webpack-elm-kernel-patcher-plugin

**Breaking changes**

- The plugin is now `ElmKernelPatcherPlugin`, `useArchive` is gone, and the
  bundled patches include `elm/core`. See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

**Added**

- `isEnabled` also takes a function, which receives the webpack compiler.
- `patches` and `elmHome`, the same options as in `cli-elm-kernel-patcher`.

#### cli-elm-kernel-patcher

**Breaking changes**

- `useArchive` is gone, `prepareArgs` and `replaceKernelPackages` take options
  and return a `Result`, and the bundled patches include `elm/core`, from
  [elm/core#1155](https://github.com/elm/core/pull/1155). See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

**Added**

- `patchKernel`: patches the Elm home and prints the outcome, like the command.
- `patches` accepts a `.tar.gz` archive of a `patches/` folder, or the folder
  itself. Your own patches skip the check of the Elm version, and a wrong
  layout stops with the layout it expects. Patches without `elm/virtual-dom`
  make Elm compile everything again at each start.
- `elmHome`, to patch an Elm home of your choice. Without it, the patcher uses
  `ELM_HOME`, or `~/.elm`.
- `archive init`, `archive build`, and `archive check`, with the
  `./archive-builder` subpath: they build your own patches from Git commits.
  The manifest and the archive live together in `elm-kernel-patcher/`, which
  `patches` accepts, and a JSON schema lets your editor complete and check the
  manifest.
- The bundled patches accept a project on Elm 0.19.3.

**Changed**

- Every outcome prints in the same layout: a highlighted line that says what
  happened, then "What happened:", "How to fix:", and "Next step:". A suggested
  command keeps the options you used, and long lines wrap to your terminal.
- Archives are extracted into a temporary folder, not inside the installed
  package, so the patcher also works when `node_modules` is read only.
- Each package in the bundled patches carries the `LICENSE` of its fork. The
  archive is built from `lib/elm-kernel-patcher.json`, which names the commit
  of each package.

#### node-elm-compiler

**Added**

- `./result-api`: the same functions, with the same names and options, that
  return a `Result` instead of throwing. Each error is a `CompileError`.
  `CompileError.title` says what went wrong in a few words, `CompileError.toCliError`
  adds the detail and the fix, and `original` keeps the exception behind it,
  when there is one.
- `dryCompile`: checks that your code compiles, without writing any file.
- `compileRunnableProgram`: compiles a program for the current process, and
  gives you a `load` function. `load` runs the code and returns the modules,
  without starting any of them. If it fails, you get a `LoadError`.

**Changed**

- `compileWorker` no longer prints the messages of a failed build. You find them
  in the error.
- `compileToString` keeps your `processOpts`, such as `env`. It used to replace
  them.
- If you compare the text of errors from the deprecated API, some of them now
  say more:
  - sources that are neither a string nor a list get a message that says so,
    not a message about the compiler;
  - a failed `compileToString` holds only the problems that Elm reports, without
    the progress lines, also in the `verbose` log;
  - `compileWorker` names a compiler that is not installed, instead of
    `Errored with exit code -2`;
  - `compileWorker` with a module whose name has a dot, such as `Tools.Echo`,
    suggests the full name, not `Tools`.

**Deprecated**

- The functions at the root of the package. See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

**Fixed**

- The deprecated `findAllDependencies` rejects again when it cannot read the
  entry file, or when the file has no valid module declaration, with the same
  value as the original package. Since 0.1.0-alpha.1 it logged the problem and
  returned what it knew, so a failed search looked like a module without
  imports.

#### elm-node-runner

**Breaking changes**

- The functions of `./runner` return a `Result`. See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

**Added**

- `startProgram`: starts a compiled program, with your launcher or with `Main`.
  Call it after `compileProgram` when you want to do something between the build
  and the start.
- `RunnerError.title` and `RunnerError.toCliError`, to show a failure to a
  person.

**Changed**

- The command tells you when the build succeeds, before your program starts,
  and keeps the messages of Elm quiet while it builds.
- When something fails, you get one error, with a title that says what went
  wrong, such as `Elm code does not compile` or `launcher threw an error`. The
  problems of Elm come under "Details:".
- A launcher that cannot be imported or that throws, a program that crashes
  while it loads, and a `Main` whose `init` throws now get a proper error. They
  used to print the bare exception.

**Deprecated**

- The `--log-info` option. See [UPGRADING.md](https://github.com/kioan000/elm-toolkit/blob/main/UPGRADING.md#from-010-alpha2-to-010-alpha3).

#### cli-lib

**Added**

- `Maybe` and `Result`, with the functions of `elm/core` as methods, so your
  steps read from top to bottom:
  `Result.fromAttempt(read).map(parse).mapError(describe)`.
  `Result.fromAttempt` turns an exception into an `Err`, and
  `Result.fromPromise` does the same for a rejected promise.
- `CliError` and `CliSuccess`, to print the outcome of a command like every
  command of the toolkit does: a highlighted title, a summary that continues
  it, and sections below. A `CliError` can carry the report of another program,
  such as a compiler, under "Details:".
- `continuingSentence`, `splitFirstLine`, and an optional title for
  `CliError.toString`, for commands that write their own messages.
- `findElmBinary`: finds the `elm` executable that your package depends on.
  Set `ELM_TEST_BINARY` to use another one, for example to run your tests with
  an older Elm.

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

[Unreleased]: https://github.com/kioan000/elm-toolkit/compare/v0.1.0-alpha.3...HEAD
[0.1.0-alpha.3]: https://github.com/kioan000/elm-toolkit/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/kioan000/elm-toolkit/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/kioan000/elm-toolkit/releases/tag/v0.1.0-alpha.1
