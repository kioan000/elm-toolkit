/**
 * Checks the types of a webpack configuration that uses the loader, as a
 * `webpack.config.ts` would write it. The file has no tests to run: the `tsc`
 * step in front of the tests checks it, and fails when a valid configuration no
 * longer compiles, or when a misspelled option is no longer an error.
 *
 * @packageDocumentation
 */

import type { Configuration } from 'webpack'

import type { ElmLoaderOptions } from '../index.ts'

const elmLoaderOptions: ElmLoaderOptions = {
  cwd: import.meta.dirname,
  debug: false,
  elmHome: 'elm-home/elm-stuff',
  files: ['src/Main.elm'],
  hotModuleReplacement: true,
  optimize: true,
  pathToElm: 'node_modules/.bin/elm',
  report: 'json',
  runtimeOptions: ['-A128M'],
  verbose: true,
}

// A misspelled option must be an error, which is the reason to type the options.
// @ts-expect-error optimise is not an option of the loader
const misspelled: ElmLoaderOptions = { optimise: true }

export const typedConfiguration = {
  module: {
    rules: [{ test: /\.elm$/, use: { loader: '@elm-toolkit/webpack-elm-loader', options: elmLoaderOptions } }],
  },
} satisfies Configuration

export { misspelled }
