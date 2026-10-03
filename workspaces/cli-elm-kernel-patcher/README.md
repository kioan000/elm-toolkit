# @elm-toolkit/cli-elm-kernel-patcher

A command line tool that replaces Elm kernel packages inside `ELM_HOME` with a
patched copy, and checks that the patched versions match the ones your project
pins in `elm.json`.

Elm compiles against the package sources it keeps in `ELM_HOME`. Patching a
kernel package therefore means editing that shared folder, and it also means
clearing the caches that Elm would otherwise reuse. The tool does both, and
refuses to run when the patched version and the pinned version disagree.

## Where the patches come from

This package does not write the patches. They come from the patched Elm kernel
packages that [lydell](https://github.com/lydell) maintains as forks, covering
`elm/core`, `elm/virtual-dom`, `elm/browser` and `elm/html`. All credit for that
work belongs there.

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

[lib/elm-kernel-patcher.json](lib/elm-kernel-patcher.json) names those commits,
one for each package. The archive in `lib/` is built from it with the `archive`
commands below, and it keeps its own copy of the code, so a project never needs
the network or the forks to patch. To change the patches of this package, change
a commit in that file and run
`corepack yarn workspace @elm-toolkit/cli-elm-kernel-patcher patches:build`. The
CI checks the archive against the manifest on every pull request that touches
them, and once a week, to notice a commit that is no longer reachable.

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

`--patches` names patches of your own. A relative path starts from the folder
that holds `elm.json`. It accepts three forms:

- a patch folder, made by the `archive` commands below: the tool uses the
  `patches.tar.gz` next to its `elm-kernel-patcher.json`;
- a `.tar.gz` archive of a `patches/` folder, made with
  `tar -czf patches.tar.gz patches`;
- such a `patches/` folder itself.

Inside `patches/`, each package sits at `<author>/<package>/<version>/`, with
its `elm.json`, its `src` and a `source.txt` file.

`--elmJsonFolder` is the folder that holds the project's `elm.json`. It defaults
to `INIT_CWD`, which npm and yarn set when they run a script, and falls back to
the current working directory. The options of the patcher go before any
subcommand; the `archive` subcommands have their own.

`--elmHome` names the Elm home to patch. A relative path starts from the folder
that holds `elm.json`. Without it, the tool patches the `ELM_HOME` of the
environment, or `~/.elm` when that is not set.

The patched packages stay in that Elm home. `~/.elm` is shared by every Elm
project on the machine, so every build that uses it compiles against the
patched kernel. A folder of its own keeps the patches to one project, but Elm
must then compile with the same `ELM_HOME`.

## Building an archive of your own

The `archive` commands build a patch archive from Git commits that you choose,
the same way this package builds its own. They work in a patch folder,
`elm-kernel-patcher/` next to `elm.json`, which holds two files:

```text
elm-kernel-patcher/
  elm-kernel-patcher.json   the manifest: which commit of which fork
  patches.tar.gz            the archive, built from the manifest
```

Start from the patches of this package, change what you need, build, and give
the folder to the patcher:

```sh
cli-elm-kernel-patcher archive init
cli-elm-kernel-patcher archive build
cli-elm-kernel-patcher --patches elm-kernel-patcher
```

`archive init` creates the folder with a copy of the manifest of this package.
It never overwrites a manifest. Each entry under `patches` names a package, the
Git address of its fork and a full commit hash; a branch name is refused,
because it can point somewhere else later, and a package may appear once.
`pullRequest` is free text for the reader:

```json
{
  "$schema": "https://raw.githubusercontent.com/kioan000/elm-toolkit/main/workspaces/cli-elm-kernel-patcher/lib/elm-kernel-patcher.schema.json",
  "patches": [
    {
      "packageName": "elm/html",
      "git": "https://github.com/lydell/html.git",
      "commit": "b35c476a69f0ba9bf8282d8c15df65e63aefea8f"
    }
  ]
}
```

The `$schema` line points at the JSON schema of the manifest, which the package
also ships in `lib/`. Editors such as VS Code and the JetBrains IDEs read it, so
they complete the fields and mark a short commit or a misspelled field as you
type. The commands ignore the line, and they check once more that a package
appears only once, which a schema cannot express.

`archive build` fetches each commit with `git` and writes `patches.tar.gz`. Any
Git server works, and a private repository works with the Git credentials you
already have. From each commit the archive keeps `elm.json`, `LICENSE` and
`src/`, and adds `source.txt` with the address of the commit. The `name` and
`version` in the `elm.json` of the commit decide where the package goes, so a
commit that holds another package stops the build.

`archive check` builds the same files again and compares them with the archive,
file by file. It fails when the two differ, or when a commit can no longer be
fetched.

`--folder` changes the patch folder, and `--elmJsonFolder` the folder it starts
from, with the same defaults as the patcher. Keep the folder in the repository,
or in a cache, and Git is needed only when a commit changes. The folder also
leaves room for more settings later.

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

The archive builder is importable too, with the same steps as the commands:

```ts
import { buildArchive, checkArchive } from '@elm-toolkit/cli-elm-kernel-patcher/archive-builder'

buildArchive({ elmJsonFolder: 'frontend' })
```

## Requirements

Node 24, an Elm project with a valid `elm.json`, and `tar` on the `PATH` when the
patches come from an archive. With the bundled patches, the project uses Elm
0.19.1 or 0.19.2. The `archive` commands also need `git`.

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
