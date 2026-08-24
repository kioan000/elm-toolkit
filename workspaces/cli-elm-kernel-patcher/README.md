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

The package ships two equivalent executables:

- **`cli-elm-kernel-patcher`** — runs the TypeScript source directly via Node's
  `--experimental-transform-types` (no build step required).
- **`cli-elm-kernel-patcher-js`** — runs the compiled JavaScript output. No
  experimental flag, marginally faster startup.

When installing from npm both are linked automatically. In a fresh clone of the
monorepo the `-js` bin is only linked after the first build, so a second
`yarn install` is needed to populate the symlink (the non-`-js` bin works from
the first install).

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
