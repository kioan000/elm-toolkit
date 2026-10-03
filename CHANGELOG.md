# Changelog

Every package in this repository shares one version, so one changelog covers
all of them. Each entry names the package it changes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
A version with a hyphen, such as `0.1.0-alpha.2`, is a pre-release.

## [Unreleased]

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
