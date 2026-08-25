#!/usr/bin/env node

/**
 * The command line interface of the Elm kernel patcher.
 *
 * The module builds the command and exports it, and only parses the arguments
 * when Node started this file. Importing it therefore has no effect, which lets a
 * caller read the command definition without running the patcher.
 *
 * @packageDocumentation
 */

import { isEntryPoint, prettyError, readPackageJson } from '@elm-toolkit/cli-lib'
import { Command } from 'commander'
import * as Patcher from './lib/patcher.ts'

const program = command()

/**
 * The patcher command, built but not yet parsed.
 *
 * Import it to inspect the options or to run the command with arguments of your
 * own. Nothing happens until `parse` is called.
 *
 * @example
 *
 * Run the command with explicit arguments
 * ```TypeScript
 *   program.parse(['--elmJsonFolder', '/path/to/project'], { from: 'user' })
 * ```
 */
export default program

if (isEntryPoint(import.meta.url)) {
  program.parse()
}

/**
 * Builds the command, with its options and the action that runs the patcher.
 *
 * The command is returned unparsed, so that building it stays free of side
 * effects.
 *
 * @returns the command, ready to be parsed by the caller
 */
function command(): Command {
  const program = new Command()

  program
    .name('cli-elm-kernel-patcher')
    .description('This scripts changes your current ELM_HOME folder with a given set of kernel patches')
    .version(readPackageJson(import.meta.url).version)
  program
    .option('--useArchive <type>', 'Whether or not use the patches archive as source of truth, true is default', 'true')
    .option(
      '--elmJsonFolder <type>',
      'Your project folder where elm.json stands, if not specified current working dir is used instead'
    )
    .action(({ elmJsonFolder, useArchive }) => {
      try {
        const parsed = JSON.parse(useArchive)
        const USE_ARCHIVE: boolean = typeof parsed === 'boolean' ? parsed : true
        const ELM_JSON_FOLDER = elmJsonFolder ? String(elmJsonFolder) : undefined

        const args = Patcher.prepareArgs(USE_ARCHIVE, ELM_JSON_FOLDER)
        Patcher.replaceKernelPackages(args)
      } catch (e) {
        prettyError('Patching failed', e)
        program.error('unknown error running elm-kernel-replacement command')
      }
    })

  return program
}
