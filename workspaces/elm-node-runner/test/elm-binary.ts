/**
 * Finds the Elm compiler that the tests run.
 *
 * The tests use the compiler from the `elm` dev dependency and never a global
 * `elm`, so every machine runs the same version. The package has no `exports`
 * map, so its manifest resolves by name, and the executable sits next to it.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Returns the path of the `elm` executable from the `elm` dev dependency.
 *
 * @example
 *
 * Compile with the pinned compiler
 * ```TypeScript
 *   await compileToString('src/Main.elm', { pathToElm: findElmBinary() })
 * ```
 *
 * @returns the absolute path of the executable
 * @throws an `Error` from Node when the package is not installed
 */
export function findElmBinary(): string {
  return path.join(path.dirname(require.resolve('elm/package.json')), 'bin', 'elm')
}
