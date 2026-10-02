# 🧰 elm-toolkit

A small, opinionated collection of tools for [Elm](https://elm-lang.org/) developers
who live in a Node + TypeScript world.

The guiding principle is **minimal dependencies**: every package here aims for
the smallest possible footprint, leaning on the standard library and native
Node features whenever possible.

Each workspace under `workspaces/` is a package of its own, with its own README.
The packages are not on the npm registry yet. Each release on GitHub carries them
as archives instead, as
[Installing from a release](#installing-from-a-release) explains.

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

Set the new versions in the manifests, merge them into `main`, then tag that
commit and push the tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The release workflow runs the same checks as a pull request, packs every public
workspace, and publishes a GitHub release with the archives.

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
