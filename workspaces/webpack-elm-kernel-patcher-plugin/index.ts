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

import type { Compiler } from 'webpack'
import { prepareArgs, replaceKernelPackages } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'
import { prettyError, prettyInfo } from '@elm-toolkit/cli-lib'

const PLUGIN_NAME = 'ElmKernelReplacementPlugin'

/**
 * Configures the plugin. Only `isEnabled` is required; the other fields keep the
 * defaults of the command line tool.
 *
 * @example
 *
 * Patch only in development, with the project in a subfolder
 * ```TypeScript
 *   const options: ElmKernelReplacementPluginOptions = {
 *     elmJsonFolder: path.join(import.meta.dirname, 'frontend'),
 *     isEnabled: mode === 'development',
 *   }
 * ```
 */
export type ElmKernelReplacementPluginOptions = {
  /**
   * The folder that holds `elm.json`. It defaults to `INIT_CWD`, which npm and
   * yarn set when they run a script, and then to the current directory.
   */
  elmJsonFolder?: string
  /** Enables or disables the plugin. When false the plugin is a no-op. */
  isEnabled: boolean
  /** Whether to extract patches from the archive (default: true). */
  useArchive?: boolean
}

/**
 * Webpack 5 plugin that patches Elm kernel packages **before** compilation starts.
 *
 * It hooks into `initialize` so that the patched packages are
 * already in place when `elm-webpack-loader` invokes the Elm compiler.
 *
 * Internally it calls the `replaceKernelPackages` function exported by the
 * `elm-kernel-replacement` CLI module directly in-process, avoiding the
 * overhead of spawning a child process on every recompilation.
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
 *     plugins: [new ElmKernelReplacementPlugin({ isEnabled: true })],
 *   }
 * ```
 */
export default class ElmKernelReplacementPlugin {
  /** Resolved plugin configuration with defaults applied */
  private readonly options: Pick<ElmKernelReplacementPluginOptions, 'elmJsonFolder'> &
    Required<Omit<ElmKernelReplacementPluginOptions, 'elmJsonFolder'>>

  /**
   * Creates a new instance of the Elm kernel replacement plugin
   *
   * @param options - plugin configuration options
   */
  public constructor(options: ElmKernelReplacementPluginOptions) {
    this.options = {
      elmJsonFolder: options.elmJsonFolder,
      isEnabled: options.isEnabled,
      useArchive: options.useArchive ?? true,
    }
  }

  /**
   * Registers the initialize hook on the given webpack compiler
   *
   * @param compiler - the webpack compiler instance
   */
  public apply(compiler: Compiler): void {
    if (!this.options.isEnabled) {
      return
    }

    compiler.hooks.initialize.tap(PLUGIN_NAME, () => {
      try {
        prettyInfo(`[${PLUGIN_NAME}]`, 'Patching Elm kernel packages before compilation…')

        const args = prepareArgs(this.options.useArchive, this.options.elmJsonFolder)
        replaceKernelPackages(args)
      } catch (error: unknown) {
        prettyError(`[${PLUGIN_NAME}]`, 'Elm kernel patching failed')

        throw error instanceof Error ? error : new Error(String(error))
      }
    })
  }
}
