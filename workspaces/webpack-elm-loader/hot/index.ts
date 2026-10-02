/**
 * A webpack loader that adds hot module replacement to compiled Elm code, with
 * the behaviour of the `elm-hot-webpack-loader` npm package.
 *
 * With it, a change to an Elm file replaces the code in the running page and
 * keeps the current model, so the page does not reload. The work happens in
 * `inject`; this module only adapts it to the loader interface.
 *
 * @packageDocumentation
 */

import { inject } from './inject.ts'

/**
 * Adds the hot reload runtime to the output of the Elm loader. List it before the
 * Elm loader in `use`, because webpack runs the loaders of a rule from the last to
 * the first. Use it only with the development server, where `module.hot` exists;
 * elsewhere the added code does nothing.
 *
 * @example
 *
 * Reload Elm modules in place during development
 * ```TypeScript
 *   use: [
 *     { loader: '@elm-toolkit/webpack-elm-loader/hot' },
 *     { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
 *   ]
 * ```
 *
 * @param content - the JavaScript that the Elm compiler produced
 * @returns the same JavaScript, with the hot reload runtime inside it
 * @throws an `Error` when the input does not come from the Elm 0.19 compiler
 */
export default function elmHotWebpackLoader(content: string | Buffer): string {
  const source = typeof content === 'string' ? content : content.toString('utf8')

  return inject(source)
}
