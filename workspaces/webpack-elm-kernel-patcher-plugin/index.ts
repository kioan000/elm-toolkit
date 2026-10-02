/**
 * A webpack plugin that applies the Elm kernel patches of
 * `@elm-toolkit/cli-elm-kernel-patcher` before webpack compiles any Elm module.
 *
 * The Elm compiler reads package sources from `ELM_HOME`, so the patches must be
 * in place before the Elm loader runs for the first time. The plugin therefore
 * runs the patcher in the `initialize` hook, which webpack calls once when it
 * creates the compiler. A rebuild in watch mode does not patch again.
 *
 * @packageDocumentation
 */

import path from 'node:path'

import type { Compiler } from 'webpack'
import { prepareArgs, replaceKernelPackages } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'
import { prettyError, prettyInfo } from '@elm-toolkit/cli-lib'

const PLUGIN_NAME = 'ElmKernelPatcherPlugin'

/**
 * Where the patched packages go. `'default'` keeps the `ELM_HOME` of the
 * environment, or `~/.elm` without one, which every Elm project on the machine
 * shares. Any other value is a folder of its own, relative to the folder that
 * holds `elm.json`.
 *
 * @example
 *
 * Keep the patched packages inside the project
 * ```TypeScript
 *   const elmHome: ElmHome = 'elm-home/elm-stuff'
 * ```
 */
export type ElmHome = 'default' | (string & {})

/**
 * Configures the plugin.
 *
 * `isEnabled` is a boolean, or a function that receives the webpack compiler
 * and decides when webpack starts. Unless it is `false`, `elmHome` is required:
 * the patched packages stay in that folder, so the choice has to be explicit.
 *
 * @example
 *
 * Patch only in development builds, into a folder of the project
 * ```TypeScript
 *   const options: ElmKernelPatcherPluginOptions = {
 *     elmHome: 'elm-home/elm-stuff',
 *     isEnabled: (compiler) => compiler.options.mode === 'development',
 *   }
 * ```
 */
export type ElmKernelPatcherPluginOptions = {
  /**
   * The folder that holds `elm.json`. It defaults to `INIT_CWD`, which npm and
   * yarn set when they run a script, and then to the current directory.
   */
  elmJsonFolder?: string
  /** Whether to extract patches from the archive (default: true). */
  useArchive?: boolean
} & (
  | {
      elmHome?: ElmHome
      /** The plugin does nothing. */
      isEnabled: false
    }
  | {
      /** Where the patched packages go; see `ElmHome`. */
      elmHome: ElmHome
      /** Enables the plugin, or decides when webpack starts. */
      isEnabled: boolean | ((compiler: Compiler) => boolean)
    }
)

/**
 * Webpack 5 plugin that patches Elm kernel packages **before** compilation starts.
 *
 * It hooks into `initialize` so that the patched packages are
 * already in place when `elm-webpack-loader` invokes the Elm compiler.
 *
 * Internally it calls the `replaceKernelPackages` function exported by
 * `@elm-toolkit/cli-elm-kernel-patcher` directly in-process, avoiding the
 * overhead of spawning a child process on every recompilation.
 *
 * With a folder as `elmHome`, the plugin also sets `ELM_HOME` for the whole
 * webpack process, so the Elm loader compiles against the same patched packages.
 *
 * When patching fails, for example because `elm.json` pins a version that the
 * patches do not cover, the plugin prints a short message and throws the error,
 * so webpack does not start.
 *
 * @example
 *
 * Patch the kernel before webpack compiles any Elm module
 * ```TypeScript
 *   export default {
 *     plugins: [new ElmKernelPatcherPlugin({ isEnabled: true, elmHome: 'elm-home/elm-stuff' })],
 *   }
 * ```
 */
export default class ElmKernelPatcherPlugin {
  /** Resolved plugin configuration with defaults applied */
  private readonly options: ElmKernelPatcherPluginOptions & { useArchive: boolean }

  /**
   * Creates a new instance of the Elm kernel replacement plugin
   *
   * @param options - plugin configuration options
   */
  public constructor(options: ElmKernelPatcherPluginOptions) {
    this.options = { ...options, useArchive: options.useArchive ?? true }
  }

  /**
   * Registers the initialize hook on the given webpack compiler
   *
   * @param compiler - the webpack compiler instance
   */
  public apply(compiler: Compiler): void {
    const { isEnabled } = this.options

    if (isEnabled === false) {
      return
    }

    compiler.hooks.initialize.tap(PLUGIN_NAME, () => {
      try {
        // A function decides here, once the configuration of webpack is complete.
        if (typeof isEnabled === 'function' && !isEnabled(compiler)) {
          return
        }

        prettyInfo(`[${PLUGIN_NAME}]`, 'Patching Elm kernel packages before compilation…')

        useElmHome(this.options.elmHome, this.options.elmJsonFolder)

        const args = prepareArgs(this.options.useArchive, this.options.elmJsonFolder)
        replaceKernelPackages(args)
      } catch (error: unknown) {
        prettyError(`[${PLUGIN_NAME}]`, 'Elm kernel patching failed')

        throw error instanceof Error ? error : new Error(String(error))
      }
    })
  }
}

/**
 * Points `ELM_HOME` at the chosen folder, for the patcher and for the Elm
 * compiler that the loader starts later in the same process.
 *
 * @param elmHome - the value of the option, which plain JavaScript may leave out
 * @param elmJsonFolder - the folder that holds `elm.json`, the base of a relative path
 * @throws Error when `elmHome` is missing
 */
function useElmHome(elmHome: ElmHome | undefined, elmJsonFolder: string | undefined): void {
  if (elmHome === undefined) {
    prettyError('elmHome checking', 'the plugin needs to know where to put the patched packages')
    console.info(
      indent(
        "elmHome: 'default' keeps ELM_HOME, or ~/.elm, which every Elm project on the machine shares\n" +
          "elmHome: 'elm-home/elm-stuff', or any folder, keeps the patched packages to this project"
      )
    )

    throw new Error("The plugin is enabled but elmHome is missing; set it to 'default' or to a folder.")
  }

  if (elmHome !== 'default') {
    process.env.ELM_HOME = path.resolve(elmJsonFolder ?? process.env.INIT_CWD ?? process.cwd(), elmHome)
  }
}

/**
 * Indents every line of a detail, so that it reads as part of the message
 * printed above it.
 *
 * @param text - the detail, on one or more lines
 * @returns the same text with each line indented
 */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}
