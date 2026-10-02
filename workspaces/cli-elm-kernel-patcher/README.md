# @elm-toolkit/cli-elm-kernel-patcher

A command line tool that replaces Elm kernel packages inside `ELM_HOME` with a
patched copy, and checks that the patched versions match the ones your project
pins in `elm.json`.

Elm compiles against the package sources it keeps in `ELM_HOME`. Patching a
kernel package therefore means editing that shared folder, and it also means
clearing the caches that Elm would otherwise reuse. The tool does both, and
refuses to run when the patched version and the pinned version disagree.

## Where the patches come from

The patches are not ours. They come from the patched Elm kernel packages that
[lydell](https://github.com/lydell) maintains as forks, covering `elm/core`,
`elm/virtual-dom`, `elm/browser` and `elm/html`. All credit for that work belongs
there.

The `elm/core`, `elm/browser` and `elm/virtual-dom` sources come from the
branches of [elm/core#1155](https://github.com/elm/core/pull/1155) and its
companion pull requests, which are still open. That `elm/core` reloads itself in
a development build, through `Elm.hot.reload()`, and the hot loader of
`@elm-toolkit/webpack-elm-loader` uses it when it is there. A production build,
made with `--optimize`, does not include that code.

This package only carries those sources and applies them safely. Every patched
package includes a `source.txt` file that records the exact upstream commit its
code was taken from, so the origin of any file can always be traced from the
patch itself rather than from this document.

The way the patches are applied comes from lydell too. The patching routine
follows `replace-kernel-packages.mjs`, the script that he publishes with
[elm-safe-virtual-dom](https://github.com/lydell/elm-safe-virtual-dom), together
with a long and careful explanation of how Elm uses `ELM_HOME`. This adapted
version is published with his permission. Thank you, Simon, for the forks, the
script and the explanation.

The forks are based on the `elm/core`, `elm/virtual-dom`, `elm/browser` and
`elm/html` packages by Evan Czaplicki, and they keep his license. The license texts are
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Usage

```sh
cli-elm-kernel-patcher [--useArchive <bool>] [--elmJsonFolder <path>]
```

`--useArchive` defaults to `true`. The tool then extracts the patch archive that
ships with the package, applies the patches, and removes the extracted folder
afterwards. Set it to `false` when you keep a `patches/` directory of your own.

`--elmJsonFolder` is the folder that holds the project's `elm.json`. It defaults
to `INIT_CWD`, which npm and yarn set when they run a script, and falls back to
the current working directory.

`ELM_HOME` overrides the default Elm home, which is `~/.elm`. Set it to a folder
of its own: the patched packages stay in `ELM_HOME`, and with the shared
`~/.elm` every Elm project and every build on the machine would use them. The
README of `@elm-toolkit/webpack-elm-kernel-patcher-plugin` shows a setup.

## What it does

The tool first reads `elm-version` from `elm.json` and checks it against the
versions the patches support, Elm 0.19.1 and 0.19.2. It stops on any other
version before it changes anything. Elm keeps its packages and its cache in
folders named after the version, so the version also decides where the tool
writes.

A new Elm version is supported by adding it to that list in `lib/patcher.ts`,
together with the patch archive it needs. Today both versions use the same
archive.

Then it reads the direct and indirect dependencies from `elm.json`. For every
patched package it finds, it checks that the version matches the pinned one and
stops if it does not.

Each patched package carries a `source.txt` file that records where the code
came from. Comparing that file against the copy already in `ELM_HOME` is how the
tool decides whether the patch still needs to be applied, so repeated runs are
cheap.

When something is out of date, the patched packages are copied into `ELM_HOME`
and the project's `elm-stuff/<version>` folder is removed, which forces Elm to
compile again from the new sources.

## Using it as a library

The patching routines are also importable, for a script that needs them without
the command line interface.

```ts
import { prepareArgs, replaceKernelPackages } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'

replaceKernelPackages(prepareArgs(true))
```

## Requirements

Node 24, an Elm 0.19.1 or 0.19.2 project with a valid `elm.json`, and `tar` on the `PATH`
when the archive mode is used.

The package installs one executable, which runs the compiled JavaScript in
`dist/`. Node refuses to strip TypeScript types from files under `node_modules`,
so an installed package cannot run its TypeScript sources. Inside this monorepo
the sources can be run directly during development:

```sh
corepack yarn workspace @elm-toolkit/cli-elm-kernel-patcher dev --help
```

In a fresh clone the executable is linked only after the second install. The
root README explains why.

## License

BSD-3-Clause, copyright kioan000. The patched Elm packages keep the notices of
their authors, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
