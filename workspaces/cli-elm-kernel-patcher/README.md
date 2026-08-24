# @elm-toolkit/cli-elm-kernel-patcher

CLI that patches Elm kernel packages inside your `ELM_HOME` against the
dependencies declared in a project's `elm.json`.

It un-archives a bundled set of patches (or reads them from a `patches/`
folder), verifies that each patched package matches the version pinned in
`elm.json`, copies the patched sources into `ELM_HOME`, and invalidates the
relevant Elm caches (`artifacts.dat`, `elm-stuff/0.19.1/`) so the next compile
picks them up.

## Usage

```sh
cli-elm-kernel-patcher [--useArchive <bool>] [--elmJsonFolder <path>]
```

The package installs a single executable, `cli-elm-kernel-patcher`, which runs
the compiled JavaScript in `dist/`. Node refuses to strip types from files under
`node_modules`, so the TypeScript sources cannot be executed from an installed
package — they ship only to back the source maps and declaration maps.

Inside this monorepo the TypeScript entry point can be run directly; Node 24
strips types natively and needs no flag:

```sh
yarn workspace @elm-toolkit/cli-elm-kernel-patcher dev --help
```

In a fresh clone the `cli-elm-kernel-patcher` symlink only appears after the
first build: Yarn links bins before `postinstall` produces `dist/`, so a second
`yarn install` is needed to populate it. Installs from npm are unaffected —
`dist/` is inside the tarball. The `dev` script works from the first install.

The patching routines are also importable:

```ts
import { prepareArgs, replaceKernelPackages } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'
```

### Options

- `--useArchive <bool>` — when `true` (default) the CLI extracts the bundled
  `patches.tar.gz` before applying patches and removes the unpacked folder
  afterwards. Set to `false` if you maintain a `patches/` directory yourself.
- `--elmJsonFolder <path>` — folder containing the project's `elm.json`.
  Defaults to `INIT_CWD` (set by npm/yarn scripts) or the current working
  directory.

### Environment

- `ELM_HOME` — overrides the default Elm home (`~/.elm`).

## How it works

1. Parses `elm.json` from the target project and collects both direct and
   indirect dependencies.
2. For every `user/package/version` triple found in the patches folder:
   - asserts that `version` matches what's pinned in `elm.json`;
   - compares each `source.txt` marker against the one already in `ELM_HOME`
     to decide whether the patch needs reapplying.
3. If anything is out of date, copies the patched packages into
   `$ELM_HOME/0.19.1/packages` and wipes the project's `elm-stuff/0.19.1/`
   so Elm recompiles from scratch.

## Requirements

- Node `>= 24.15 < 25`
- An Elm 0.19.1 project with a valid `elm.json`
- `tar` available on `PATH` (only when `--useArchive=true`)
