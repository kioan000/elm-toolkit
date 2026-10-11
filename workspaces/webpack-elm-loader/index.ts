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
type PromiseResult = { result: string | boolean; type_: 'Success' } | { error: unknown; type_: 'Error' }

/**
 * The options of the loader, for a typed webpack configuration. A rule names
 * the loader by its package name or path, and webpack loads the module itself,
 * so the options are the part that TypeScript can check: give them this type,
 * and a misspelled option is an error in the editor. Every option is optional.
 *
 * @example
 *
 * Type the options of the loader in `webpack.config.ts`
 * ```TypeScript
 *   const elmLoaderOptions: ElmLoaderOptions = { cwd: import.meta.dirname, optimize: true }
 *
 *   export default {
 *     module: { rules: [{ test: /\.elm$/, use: { loader: '@elm-toolkit/webpack-elm-loader', options: elmLoaderOptions } }] },
 *   } satisfies Configuration
 * ```
 */
export interface ElmLoaderOptions {
  /** The folder where Elm runs, and where it looks for `elm.json`. In watch mode, also the folder whose `elm.json` and source directories are watched. */
  cwd?: string
  /** Adds the Elm debugger, with `--debug`. On by default in development mode. */
  debug?: boolean
  /** The `ELM_HOME` of the compiler, relative to `cwd`. Without it, Elm uses the `ELM_HOME` of the environment, or `~/.elm`. */
  elmHome?: string
  /** The modules to compile into one bundle, instead of the module that webpack asks for. */
  files?: string[]
  /** Adds hot module replacement to the output. On by default in development mode. */
  hotModuleReplacement?: boolean
  /** Builds with `--optimize`. On by default in production mode. */
  optimize?: boolean
  /** The Elm binary to run, such as `node_modules/.bin/elm`. Without it, the `elm` on the `PATH`. */
  pathToElm?: string
  /** The format of the report of Elm, passed to `--report`, such as `json`. */
  report?: string
  /** Options for the runtime of the compiler, passed between `+RTS` and `-RTS`. */
  runtimeOptions?: ReadonlyArray<string>
  /** Prints the compiler command before it runs. */
  verbose?: boolean
}

// What the loader reads: the options of the rule or of a query string, which can hold any key.
// The compiler refuses a key that it does not know, so a misspelled option still stops the build.
type ReceivedOptions = ElmLoaderOptions & { [key: string]: unknown; output?: string }

/**
 * Get files to compile from loader options or use the resource path.
 *
 * @param context - Webpack loader context
 * @param options - Loader options
 * @returns Array of file paths to compile
 *
 * @throws Error
 */
function getFiles(context: LoaderContext<ReceivedOptions>, options: ReceivedOptions): string[] {
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
function parseLoaderOptions(context: LoaderContext<ReceivedOptions>): ReceivedOptions {
  // The options come from the rule, as an object or a query string. The query of the requested
  // module, such as `./Main.elm?v=2`, belongs to the import and is not read.
  const query = context.query || ''

  // If query is already an object, return it directly
  if (typeof query === 'object') {
    return query as ReceivedOptions
  }

  // Handle string queries
  if (typeof query !== 'string' || query === '') {
    return {}
  }

  // Parse query string (e.g., "?debug=true&optimize=false")
  const cleanQuery = query.startsWith('?') ? query.slice(1) : query
  const params = new URLSearchParams(cleanQuery)
  const options: ReceivedOptions = {}

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
function getOptions(context: LoaderContext<ReceivedOptions>, mode: string | undefined): ReceivedOptions {
  const defaultOptions: ReceivedOptions = {
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

      switch (found.type_) {
        case 'Ok':
          return found.value
        case 'Err':
          // The build still runs, and elm make reports the same problem with its own message.
          warn(CliError.toString(CompileError.toCliError(found.error), CompileError.title(found.error)))

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
async function compileElm(sources: string[], options: ReceivedOptions): Promise<string> {
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

    switch (started.type_) {
      case 'Err':
        fs.rmSync(tempDir, { force: true, recursive: true })
        reject(new Error(CliError.toString(CompileError.toCliError(started.error), CompileError.title(started.error))))

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
export default async function elmWebpackLoader(this: LoaderContext<ReceivedOptions>): Promise<void> {
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

          return { result: true, type_: 'Success' as const }
        })
        .catch((error) => {
          this.emitError(error)

          return { error, type_: 'Error' as const }
        })

      promises.push(dependenciesPromise)
    }

    // Compile Elm
    const compilationPromise = compileElm(files, options)
      .then((result) => {
        return { result, type_: 'Success' as const }
      })
      .catch((error) => {
        return { error, type_: 'Error' as const }
      })

    promises.push(compilationPromise)

    // Wait for all promises and handle results
    const results = await Promise.all(promises)
    const output = results[results.length - 1] as PromiseResult

    if (output.type_ === 'Success') {
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
