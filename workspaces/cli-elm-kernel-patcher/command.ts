#!/usr/bin/env node
import { prettyError } from '@elm-toolkit/cli-lib'
import { Command } from 'commander'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as Patcher from './lib/patcher.ts'

const program = command()

export default program

if (isEntryPoint()) {
  program.parse()
}

/**
 * CLI for elm-kernel-replacement command
 * @returns - a valid Command instance for the elm-kernel-replacement command (and its options)
 */
function command(): Command {
  const program = new Command()

  program
    .name('cli-elm-kernel-patcher')
    .description(
      'This scripts changes your current ELM_HOME folder with a given set of kernel patches'
    )
    .version('0.0.1')
  program
    .option(
      '--useArchive <type>',
      'Whether or not use the patches archive as source of truth, true is default',
      'true'
    )
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

/**
 * Whether this module is the program Node was started with, as opposed to being
 * imported by something else. process.argv[1] holds the path Node was given,
 * which for an installed CLI is the symlink in node_modules/.bin, while
 * import.meta.url is always the resolved file; the symlink has to be followed
 * before the two can be compared.
 * @returns - true when the module is running as the entry point
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]

  if (entry === undefined) {
    return false
  }

  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}
