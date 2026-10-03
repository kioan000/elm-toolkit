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

The shipped patches contain these changes:

- `elm/core` from [elm/core#1155](https://github.com/elm/core/pull/1155), which
  adds hot reloading and a way to stop a running mvu app;
- `elm/browser` from [lydell/browser#1](https://github.com/lydell/browser/pull/1),
  which lets `Browser.element`, `Browser.document` and `Browser.application`
  reload and stop, together with the debugger. It also draws the first view at
  the right time, so a web component that sends an event while it renders no
  longer crashes Elm;
- `elm/virtual-dom` from
  [lydell/virtual-dom#1](https://github.com/lydell/virtual-dom/pull/1), which
  does the same for a program that is only a view, and removes the event
  listeners of a stopped app, so another Elm app can use the same DOM node.

The `elm/core` patch adds a dedicated API, `Elm.hot.reload()`, which a hot
reloading tool can call.

**A production build, made with `--optimize`, does not include that code.**

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
cli-elm-kernel-patcher [--patches <path>] [--elmHome <path>] [--elmJsonFolder <path>]
```

Without `--patches`, the tool uses the patch archive that ships with the
package. It extracts the archive into a temporary folder, applies the patches,
and removes the folder afterwards.

`--patches` names patches of your own: a `.tar.gz` archive of a `patches/`
folder, or that folder itself. A relative path starts from the folder that
holds `elm.json`. Inside `patches/`, each package sits at
`<author>/<package>/<version>/`, with its `elm.json`, its `src` and a
`source.txt` file. An archive is made with `tar -czf patches.tar.gz patches`.

`--elmJsonFolder` is the folder that holds the project's `elm.json`. It defaults
to `INIT_CWD`, which npm and yarn set when they run a script, and falls back to
the current working directory.

`--elmHome` names the Elm home to patch. A relative path starts from the folder
that holds `elm.json`. Without it, the tool patches the `ELM_HOME` of the
environment, or `~/.elm` when that is not set.

The patched packages stay in that Elm home. `~/.elm` is shared by every Elm
project on the machine, so every build that uses it compiles against the
patched kernel. A folder of its own keeps the patches to one project, but Elm
must then compile with the same `ELM_HOME`.

## What it does

The tool first reads `elm-version` from `elm.json` and checks it against the
Elm versions it supports today, 0.19.1 and 0.19.2. It stops on any other
version before it changes anything. This is a safety measure. The patcher
expects a specific folder structure in the Elm home, and another Elm version
may change it.

With patches of your own, this check is skipped. Each patched package still
carries its own version, and it must match the version that `elm.json` pins.
So a patch never applies to another version of a kernel package.

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

replaceKernelPackages(
  prepareArgs({
    elmJsonFolder: 'yourprj/frontend',
    patches: 'kernel-patches/patches.tar.gz',
  })
)
```

## Requirements

Node 24, an Elm project with a valid `elm.json`, and `tar` on the `PATH` when the
patches come from an archive. With the bundled patches, the project uses Elm
0.19.1 or 0.19.2.

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
