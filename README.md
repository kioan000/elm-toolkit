# 🧰 elm-toolkit

A small, opinionated collection of tools for [Elm](https://elm-lang.org/) developers
who live in a Node + TypeScript world.

The guiding principle is **minimal dependencies**: every package here aims for
the smallest possible footprint, leaning on the standard library and native
Node features whenever possible.

## Packages

Each package has a README that explains how to use it.

| Package                                                                             | What it does                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`webpack-elm-loader`](workspaces/webpack-elm-loader)                               | Compiles Elm modules in webpack, with hot reloading that keeps the state of your app in development.                           |
| [`webpack-elm-kernel-patcher-plugin`](workspaces/webpack-elm-kernel-patcher-plugin) | Applies patches to the Elm kernel packages before webpack compiles, for example the hot reloading of `elm/core`.               |
| [`cli-elm-kernel-patcher`](workspaces/cli-elm-kernel-patcher)                       | The same patching as a command and a library, and the `archive` commands that build patches from Git commits.                  |
| [`node-elm-compiler`](workspaces/node-elm-compiler)                                 | Runs the Elm compiler from Node, with an API that returns every failure as a value. A rewrite of the package of the same name. |
| [`elm-node-runner`](workspaces/elm-node-runner)                                     | Runs a headless Elm program in Node, from the command line or from code.                                                       |
| [`cli-lib`](workspaces/cli-lib)                                                     | `Maybe`, `Result`, and readable error messages for command line programs. Every other package uses it.                         |

The packages are not on the npm registry yet. Each release on GitHub carries
them as archives instead, as [Installing from a release](#installing-from-a-release)
explains. [CHANGELOG.md](CHANGELOG.md) lists what changed in each release, and
[UPGRADING.md](UPGRADING.md) what to edit in your project when you move to a new
version.

## Installing from a release

Every release has one archive for each package, named after the package and its
version. Point the dependency at the URL of the archive:

```json
{
  "dependencies": {
    "@elm-toolkit/node-elm-compiler": "https://github.com/kioan000/elm-toolkit/releases/download/v0.1.0-alpha.2/elm-toolkit-node-elm-compiler-0.1.0-alpha.2.tgz"
  }
}
```

Some packages depend on other packages of this repository, for example the
webpack loader on `@elm-toolkit/node-elm-compiler`. Their manifests ask for those
packages by version, which the npm registry cannot provide. List the archive of
each of them as well; the `dependencies` field in the `package.json` of a
package names them.

npm uses the archives you list. Yarn looks for those dependencies on the
registry, so it also needs them in `resolutions`:

```json
{
  "dependencies": {
    "@elm-toolkit/webpack-elm-loader": "https://github.com/kioan000/elm-toolkit/releases/download/v0.1.0-alpha.2/elm-toolkit-webpack-elm-loader-0.1.0-alpha.2.tgz",
    "@elm-toolkit/node-elm-compiler": "https://github.com/kioan000/elm-toolkit/releases/download/v0.1.0-alpha.2/elm-toolkit-node-elm-compiler-0.1.0-alpha.2.tgz"
  },
  "resolutions": {
    "@elm-toolkit/node-elm-compiler": "https://github.com/kioan000/elm-toolkit/releases/download/v0.1.0-alpha.2/elm-toolkit-node-elm-compiler-0.1.0-alpha.2.tgz"
  }
}
```

## Requirements

Node 24 and Yarn 4. Yarn is pinned in `packageManager` and resolved by corepack,
so run it as `corepack yarn`. A global Yarn 1 installation rewrites `yarn.lock`
into the old Classic format if it runs here by mistake.

## Getting started

```sh
corepack yarn install
```

The install also builds every workspace.

In a fresh clone the command line executables appear only after a second
`corepack yarn install`. Yarn creates the links in `node_modules/.bin` before
the build has produced `dist/`, so the first install has nothing to link. This
affects the monorepo only. An install from npm is not affected, because `dist/`
is already inside the published package.

## Build

```sh
corepack yarn build     # build every workspace
corepack yarn clean     # remove the build output
```

Each workspace compiles with `tsc -b` into its own `dist/` directory. The
workspaces are connected by TypeScript project references, and the root script
passes `-t` to `yarn workspaces foreach`, so the packages build in dependency
order.

The root `postinstall` script looks redundant next to the `prepare` script in
each workspace, but it is not. Yarn does not run workspace `prepare` scripts
during `yarn install`, so a fresh install builds nothing without it. The
`prepare` scripts are still needed, because npm runs them before publishing.

### When the build produces nothing

Two caches can decide that there is no work to do, and both stay quiet about it.

`tsc -b` keeps a `.tsbuildinfo` file to decide what is already current. If that
file survives while `dist/` is deleted, the compiler decides everything is up to
date and emits nothing. The failure then appears somewhere else, as a missing
module reported by a workspace that depends on the one that stayed silent.

Yarn keeps its own record, in `.yarn/build-state.yml`, of the scripts it has
already run. Deleting `dist/` and running `corepack yarn install` therefore does
not rebuild anything, because Yarn treats the root `postinstall` as already done.

Run `corepack yarn clean` and then `corepack yarn build`, which ignores both
caches.

## Tests

```sh
corepack yarn test
```

The tests run the real Elm compiler, the one that the `elm` dev dependency pins.
`ELM_TEST_BINARY` makes them run another one, and the test projects must then
declare its version in `elm.json`. CI runs every test suite once for each Elm
version that the toolkit supports, this way.

A package whose test files compile the same test project runs those files one
at a time, with `--test-concurrency=1`. Elm 0.19.1 corrupts the cache in
`elm-stuff/` when two builds of one project run at once.

Two scripts print every message that a user can see, to read them all after a
change to a message: each error and log line of `node-elm-compiler`, and the
output of the `elm-node-runner` command in every case.

```sh
corepack yarn workspace @elm-toolkit/node-elm-compiler messages
corepack yarn workspace @elm-toolkit/elm-node-runner messages
```

## Publishing

Every published entry point must be compiled JavaScript. Node 24 strips
TypeScript types on its own, but it refuses to do so for files under
`node_modules`:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]
```

No flag changes this. A package that points `bin`, `main` or `exports` at a
`.ts` file therefore fails as soon as somebody installs it. TypeScript sources
are still published, but only to support the source maps and the declaration
maps.

This is easy to miss inside the monorepo. A workspace is linked by a symlink
that resolves outside `node_modules`, so a TypeScript entry point runs here and
fails everywhere else.

### Checking a package before you trust it

```sh
corepack yarn workspace <name> pack -o /tmp/pkg.tgz
cd $(mktemp -d) && npm init -y && npm install /tmp/pkg.tgz
```

Then run the executable and import the entry points. This is the only setup that
reproduces the `node_modules` condition described above.

Keys in an `exports` map are conditions, not free labels. A key that Node does
not know resolves to nothing and reports no error, so subpaths belong on the
left side of the map and `types` and `default` on the right.

### Making a release

Every pull request that changes a published package adds a line under
`Unreleased` in [CHANGELOG.md](CHANGELOG.md), and a breaking change also adds
its steps to [UPGRADING.md](UPGRADING.md). To release, rename that section to
the new version and the date, add an empty `Unreleased` above it, and update the
links at the bottom of the file. In `UPGRADING.md`, the section for the new
version must already have its final title, because the changelog links to it. Set the new versions in the manifests, merge
both changes into `main`, then tag that commit and push the tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The release workflow runs the same checks as a pull request, packs every public
workspace, and publishes a GitHub release with the archives. The notes of the
release are the section of the changelog for that version, followed by the list
of pull requests. A tag whose version has no section in the changelog stops the
workflow before anything is published.

A version with a hyphen, such as `0.1.0-alpha.1`, is a pre-release. Give the
manifests and the tag the same version, `v0.1.0-alpha.1` in that case, and
GitHub marks the release as a pre-release.

## Thanks

Several packages here continue the work of other people, and they are credited
in the README of each package. In short: Richard Feldman for `node-elm-compiler`,
`find-elm-dependencies` and `elm-webpack-loader`; the elm-community organization
for maintaining `elm-webpack-loader`; Keith Lazuka for `elm-hot`; Flux Xu for
`elm-hot-loader`; Joakin for `elm-node`; Simon Lydell for the patched kernel
packages and the script that applies them; and Evan Czaplicki for Elm itself. Thank you all, and thank
you to every contributor of those projects.

## License

BSD-3-Clause, copyright kioan000. See [LICENSE](LICENSE). Packages that contain
code from other projects also ship a `THIRD_PARTY_NOTICES.md` file with the
licenses of that code.

## Contributing

Repository conventions, including how documentation and comments are written,
are collected in [AGENTS.md](AGENTS.md).
