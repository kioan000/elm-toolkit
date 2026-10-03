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
import { patchKernel } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'
import { CliError, prettyError, prettyInfo } from '@elm-toolkit/cli-lib'

const PLUGIN_NAME = 'ElmKernelPatcherPlugin'

/**
 * Configures the plugin.
 *
 * `isEnabled` is a boolean, or a function that receives the webpack compiler
 * and decides when webpack starts. The other fields are optional and keep the
 * defaults of the command line tool.
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
   * The Elm home to patch, relative to the folder that holds `elm.json`. Without
   * it, the `ELM_HOME` of the environment is used, or `~/.elm` when that is not
   * set. The Elm loader must compile with the same Elm home.
   */
  elmHome?: string
  /**
   * The folder that holds `elm.json`. It defaults to `INIT_CWD`, which npm and
   * yarn set when they run a script, and then to the current directory.
   */
  elmJsonFolder?: string
  /** Enables the plugin, or decides when webpack starts. */
  isEnabled: boolean | ((compiler: Compiler) => boolean)
  /**
   * Patches of your own, relative to the folder that holds `elm.json`: a patch
   * folder made by `cli-elm-kernel-patcher archive`, a `.tar.gz` archive of a
   * `patches/` folder, or the folder itself. Without it, the archive of
   * `@elm-toolkit/cli-elm-kernel-patcher` is used.
   */
  patches?: string
}

/**
 * Webpack 5 plugin that patches Elm kernel packages **before** compilation starts.
 *
 * It hooks into `initialize` so that the patched packages are
 * already in place when `elm-webpack-loader` invokes the Elm compiler.
 *
 * Internally it calls the `patchKernel` function exported by
 * `@elm-toolkit/cli-elm-kernel-patcher` directly in-process, avoiding the
 * overhead of spawning a child process on every recompilation.
 *
 * When patching fails, for example because `elm.json` pins a version that the
 * patches do not cover, the patcher prints the reason, and the plugin throws it
 * as an error, because that is how a plugin stops webpack.
 *
 * @example
 *
 * Patch the kernel before webpack compiles any Elm module
 * ```TypeScript
 *   export default {
 *     plugins: [new ElmKernelPatcherPlugin({ isEnabled: true })],
 *   }
 * ```
 */
export default class ElmKernelPatcherPlugin {
  /** The plugin configuration, as the caller gave it */
  private readonly options: ElmKernelPatcherPluginOptions

  /**
   * Creates a new instance of the Elm kernel patcher plugin
   *
   * @param options - plugin configuration options
   */
  public constructor(options: ElmKernelPatcherPluginOptions) {
    this.options = options
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

        const { elmHome, elmJsonFolder, patches } = this.options
        const patched = patchKernel({ elmHome, elmJsonFolder, patches })

        switch (patched.tag) {
          case 'Ok':
            return
          case 'Err':
            // The patcher has printed the reason already; webpack stops only on an exception.
            throw new Error(CliError.toString(patched.error))
        }
      } catch (error: unknown) {
        prettyError(`[${PLUGIN_NAME}]`, 'Elm kernel patching failed')

        throw error instanceof Error ? error : new Error(String(error))
      }
    })
  }
}
