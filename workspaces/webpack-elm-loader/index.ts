/**
 * A webpack loader that turns an Elm module into the JavaScript the Elm compiler
 * produces. It is a fork of the `elm-webpack-loader` npm package.
 *
 * The loader does two jobs. It runs `elm make` on the requested file and returns
 * the output. In watch mode it also tells webpack which other files the module
 * imports, because webpack cannot read Elm imports on its own and would miss a
 * change in any file but the entry.
 *
 * In development mode it also adds hot module replacement to the output, through
 * `hot/inject.ts`, so a change to an Elm file updates the running page.
 *
 * Read `elmWebpackLoader` first. The helpers above it read the options, compile
 * to a temporary file, and collect the dependencies.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { LoaderContext } from 'webpack'

import { CliError } from '@elm-toolkit/cli-lib'
import { CompileError, compile, findAllDependencies } from '@elm-toolkit/node-elm-compiler/result-api'

import { inject } from './hot/inject.ts'

/**
 * Result type for promise outcomes.
 */
type PromiseResult = { kind: 'success'; result: string | boolean } | { error: unknown; kind: 'error' }

/**
 * Webpack loader options for Elm compilation.
 */
interface ElmLoaderOptions {
  [key: string]: unknown
  cwd?: string
  debug?: boolean
  elmHome?: string
  files?: string[]
  hotModuleReplacement?: boolean
  optimize?: boolean
  output?: string
  pathToElm?: string
  report?: string
}

/**
 * Get files to compile from loader options or use the resource path.
 *
 * @param context - Webpack loader context
 * @param options - Loader options
 * @returns Array of file paths to compile
 *
 * @throws Error
 */
function getFiles(context: LoaderContext<ElmLoaderOptions>, options: ElmLoaderOptions): string[] {
  const files = options?.files

  if (files === undefined) {
    return [context.resourcePath]
  }

  if (!Array.isArray(files)) {
    throw new Error('files option must be an array')
  }

  if (files.length === 0) {
    throw new Error("You specified the 'files' option but didn't list any files")
  }

  delete options.files

  return files
}

/**
 * Get loader options from webpack context.
 *
 * @param context - Webpack loader context
 * @returns Parsed loader options
 */
function parseLoaderOptions(context: LoaderContext<ElmLoaderOptions>): ElmLoaderOptions {
  // The options come from the rule, as an object or a query string. The query of the requested
  // module, such as `./Main.elm?v=2`, belongs to the import and is not read.
  const query = context.query || ''

  // If query is already an object, return it directly
  if (typeof query === 'object') {
    return query as ElmLoaderOptions
  }

  // Handle string queries
  if (typeof query !== 'string' || query === '') {
    return {}
  }

  // Parse query string (e.g., "?debug=true&optimize=false")
  const cleanQuery = query.startsWith('?') ? query.slice(1) : query
  const params = new URLSearchParams(cleanQuery)
  const options: ElmLoaderOptions = {}

  for (const [key, value] of params) {
    if (value === 'true') {
      options[key] = true
    } else if (value === 'false') {
      options[key] = false
    } else if (key === 'files') {
      // Handle files as JSON array
      options[key] = JSON.parse(value)
    } else {
      options[key] = value
    }
  }

  return options
}

/**
 * Merge default options with loader options.
 *
 * @param context - Webpack loader context
 * @param mode - Webpack build mode (development/production)
 * @returns Merged compiler options
 */
function getOptions(context: LoaderContext<ElmLoaderOptions>, mode: string | undefined): ElmLoaderOptions {
  const defaultOptions: ElmLoaderOptions = {
    debug: mode === 'development',
    hotModuleReplacement: mode === 'development',
    optimize: mode === 'production',
  }

  const loaderOptions = parseLoaderOptions(context)

  return Object.assign({}, defaultOptions, loaderOptions)
}

/**
 * Read source directories from elm.json. A package has no source-directories
 * field, so its src folder is used; a missing elm.json gives no directories.
 *
 * @param cwd - Current working directory
 * @returns Array of source directory paths
 */
function filesToWatch(cwd: string): string[] {
  const elmJsonPath = path.join(cwd, 'elm.json')

  // Without elm.json the compiler fails with its own, clearer message.
  if (!fs.existsSync(elmJsonPath)) {
    return []
  }

  const elmJson = JSON.parse(fs.readFileSync(elmJsonPath, 'utf8')) as { 'source-directories'?: string[] }

  // A package lists no source directories; its modules are always in src.
  return (elmJson['source-directories'] ?? ['src']).map((dir) => path.join(cwd, dir))
}

/**
 * Find all dependencies for given files.
 *
 * @param resourcePath - Current resource being compiled
 * @param files - Files to analyze
 * @param warn - Receives the message of a file whose dependencies could not be found
 * @returns Promise resolving to unique dependencies
 */
async function dependenciesFor(
  resourcePath: string,
  files: string[],
  warn: (message: string) => void
): Promise<string[]> {
  const dependenciesPerFile = await Promise.all(
    files.map(async (file) => {
      const found = await findAllDependencies(file)

      switch (found.tag) {
        case 'Ok':
          return found.value
        case 'Err':
          // The build still runs, and elm make reports the same problem with its own message.
          warn(CliError.toString(CompileError.toCliError(found.error)))

          return []
      }
    })
  )

  const allDependencies = flatten(dependenciesPerFile)

  return unique([...allDependencies, ...remove(resourcePath, files)])
}

/**
 * Flatten array of arrays into single array.
 *
 * @param arrayOfArrays - Array of arrays
 * @returns Flattened array
 */
function flatten<T>(arrayOfArrays: ReadonlyArray<ReadonlyArray<T>>): T[] {
  return (arrayOfArrays as Array<Array<T>>).reduce((flattened, array) => flattened.concat(array), [])
}

/**
 * Get unique items from array, preserving order.
 *
 * @param items - Input items
 * @returns Items with duplicates removed
 */
function unique(items: string[]): string[] {
  return items.filter((item, index, array) => array.indexOf(item) === index)
}

/**
 * Remove item from array.
 *
 * @param condemned - Item to remove
 * @param items - Array to filter
 * @returns Array without condemned item
 */
function remove(condemned: string, items: string[]): string[] {
  return items.filter((item) => item !== condemned)
}

/**
 * Get file extension suffix.
 *
 * @param outputPath - Optional output path
 * @param defaultSuffix - Fallback extension
 * @returns File extension
 */
function getSuffix(outputPath: string | undefined, defaultSuffix: string): string {
  if (outputPath) {
    return path.extname(outputPath) || defaultSuffix
  }

  return defaultSuffix
}

/**
 * Compile Elm sources to JavaScript.
 *
 * @param sources - Source files to compile
 * @param options - Compiler options
 * @returns Promise resolving to compiled JavaScript
 */
async function compileElm(sources: string[], options: ElmLoaderOptions): Promise<string> {
  const suffix = getSuffix(options.output, '.js')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elm-webpack-'))
  const outputPath = path.join(tempDir, `elm-output${suffix}`)

  return new Promise((resolve, reject) => {
    // The compiler refuses options it does not know: elmHome reaches it as ELM_HOME instead,
    // and hotModuleReplacement belongs to the loader alone.
    const { elmHome, ...compilerOptions } = options
    delete compilerOptions.hotModuleReplacement
    const env = elmHome === undefined ? {} : { env: { ELM_HOME: path.resolve(options.cwd ?? process.cwd(), elmHome) } }
    const finalOptions = {
      ...compilerOptions,
      output: outputPath,
      processOpts: { stdio: 'inherit' as const, ...env },
    }

    const started = compile(sources, finalOptions)

    switch (started.tag) {
      case 'Err':
        fs.rmSync(tempDir, { force: true, recursive: true })
        reject(new Error(CliError.toString(CompileError.toCliError(started.error))))

        return
      case 'Ok': {
        const compiler = started.value

        compiler.on('close', (exitCode: unknown) => {
          if (exitCode !== 0) {
            fs.rmSync(tempDir, { force: true, recursive: true })
            reject(new Error('Compilation failed'))

            return
          }

          fs.readFile(outputPath, { encoding: 'utf8' }, (err, data) => {
            // Clean up temp directory
            fs.rmSync(tempDir, { force: true, recursive: true })

            if (err) {
              reject(err)
            } else {
              resolve(data)
            }
          })
        })

        compiler.on('error', (err) => {
          fs.rmSync(tempDir, { force: true, recursive: true })
          reject(err)
        })
      }
    }
  })
}

/**
 * Compiles the Elm module that webpack asks for. Register it for `.elm` files.
 *
 * By default the build uses `--debug` in development mode and `--optimize` in
 * production mode, and adds hot module replacement in development mode. The
 * options can change that, and can pass any other option of
 * `@elm-toolkit/node-elm-compiler`, such as `pathToElm`. The `files` option
 * compiles several modules into one bundle instead of the requested file alone.
 *
 * A failed build reaches webpack as an error, and the compiler messages appear in
 * the terminal. In watch mode, `cwd` also makes the loader watch `elm.json` and
 * every source directory it lists.
 *
 * @example
 *
 * Compile Elm files in a webpack configuration
 * ```TypeScript
 *   module: {
 *     rules: [{
 *       test: /\.elm$/,
 *       exclude: [/elm-stuff/, /node_modules/],
 *       use: { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
 *     }],
 *   }
 * ```
 *
 * @param this - the context that webpack gives to every loader
 * @returns a promise that settles after the loader has passed the output, or the
 * error, to webpack
 */
export default async function elmWebpackLoader(this: LoaderContext<ElmLoaderOptions>): Promise<void> {
  // Mark this loader as cacheable
  if (this.cacheable) {
    this.cacheable()
  }

  const callback = this.async()

  if (!callback) {
    throw new Error('elm-webpack-loader currently only supports async mode.')
  }

  try {
    const compiler = this._compiler

    if (!compiler) {
      throw new Error('Webpack compiler instance is not available')
    }

    const options = getOptions(this, compiler.options.mode)
    const files = getFiles(this, options)
    const resourcePath = this.resourcePath

    const promises: Array<Promise<PromiseResult>> = []

    // Track dependencies in watch mode
    if (compiler.watching) {
      // Watch elm.json if cwd is specified
      if (typeof options.cwd === 'string' && options.cwd !== null) {
        const elmJsonPath = path.join(options.cwd, 'elm.json')

        this.addDependency(elmJsonPath)

        const dirs = filesToWatch(options.cwd)

        dirs.forEach((dir) => {
          this.addContextDependency(dir)
        })
      }

      // Find all dependencies and add them to watch list
      const dependenciesPromise = dependenciesFor(resourcePath, files, (message) => {
        this.emitWarning(new Error(message))
      })
        .then((deps) => {
          deps.forEach((dep) => {
            this.addDependency(dep)
          })

          return { kind: 'success' as const, result: true }
        })
        .catch((error) => {
          this.emitError(error)

          return { error, kind: 'error' as const }
        })

      promises.push(dependenciesPromise)
    }

    // Compile Elm
    const compilationPromise = compileElm(files, options)
      .then((result) => {
        return { kind: 'success' as const, result }
      })
      .catch((error) => {
        return { error, kind: 'error' as const }
      })

    promises.push(compilationPromise)

    // Wait for all promises and handle results
    const results = await Promise.all(promises)
    const output = results[results.length - 1] as PromiseResult

    if (output.kind === 'success') {
      const javascript = output.result as string

      callback(null, options.hotModuleReplacement === true ? inject(javascript) : javascript)
    } else {
      let compiledError: Error

      if (output.error instanceof Error) {
        compiledError = output.error
      } else if (typeof output.error === 'string') {
        compiledError = new Error(output.error)
      } else {
        compiledError = new Error(String(output.error))
      }

      compiledError.message = `Compiler process exited with error: ${compiledError.message}`
      callback(compiledError)
    }
  } catch (err) {
    let finalError: Error

    if (err instanceof Error) {
      finalError = err
    } else if (typeof err === 'string') {
      finalError = new Error(err)
    } else {
      finalError = new Error(String(err))
    }

    callback(finalError)
  }
}
