import { prettyInfo } from '@elm-toolkit/cli-lib'
import path from 'node:path'
import fs from 'node:fs'
import * as os from 'node:os'
import * as childProcess from 'node:child_process'

const __dirname = import.meta.dirname

/**
 * Prepare arguments for replaceKernelFunction
 *
 * @param useArchive - if true uses archive zip or folder mode
 * @param elmJsonFolder - specify project elm.json folder, calling folder is used instead
 * @returns a ReplaceKernelArgs object
 */
export function prepareArgs(useArchive: boolean, elmJsonFolder?: string): ReplaceKernelArgs {
  const ROOT = elmJsonFolder ?? process.env.INIT_CWD ?? process.cwd()
  const CURRENT = __dirname
  const ELM_HOME = process.env.ELM_HOME || path.join(os.homedir(), '.elm')
  const ELM_HOME_PACKAGES = path.join(ELM_HOME, '0.19.1', 'packages')

  return {
    CURRENT: CURRENT,
    ELM_HOME: ELM_HOME,
    ELM_HOME_PACKAGES: ELM_HOME_PACKAGES,
    PATCH_ARCHIVE: path.join(CURRENT, 'patches.tar.gz'),
    PATCH_DIR: path.join(CURRENT, 'patches'),
    PROJECT_ELM_ROOT: ROOT,
    PROJECT_ELM_STUFF: path.join(ROOT, 'elm-stuff', '0.19.1'),
    USE_ARCHIVE: useArchive,
  }
}

export type ReplaceKernelArgs = {
  CURRENT: string
  ELM_HOME: string
  ELM_HOME_PACKAGES: string
  PATCH_ARCHIVE: string
  PATCH_DIR: string
  PROJECT_ELM_ROOT: string
  PROJECT_ELM_STUFF: string
  USE_ARCHIVE: boolean
}

export function replaceKernelPackages(args: ReplaceKernelArgs): void {
  prettyInfo('> Running:', 'Elm Kernel Replacement script with given params')
  console.info(args)
  console.info('\n')
  let elmJsonDependencies

  try {
    elmJsonDependencies = parseElmJsonDependencies(path.join(args.PROJECT_ELM_ROOT, 'elm.json'))
  } catch (error) {
    throw new Error(
      `Failed to parse elm.json: ${error instanceof Error ? error.message : String(error)} `
    )
  }
  let alreadyUpToDate = true
  if (args.USE_ARCHIVE) {
    prettyInfo('> Running:', "I'll un-archive patch folder:", args.PATCH_ARCHIVE)
    childProcess.execFileSync('tar', ['-xzf', args.PATCH_ARCHIVE, '-C', args.CURRENT])
  }

  for (const user of readDir(args.PATCH_DIR)) {
    for (const package_ of readDir(user.path)) {
      const versions = readDir(package_.path)
      if (versions.length !== 1) {
        throw new Error(
          `Replace Kernel packages: Found more than one version! \n\nVersions: ${versions
            .map((version) => version.name)
            .join(', ')}\n\nIn: ${package_.path}`
        )
      }

      const [version] = versions
      const packageIdentifier = `${user.name}/${package_.name}`
      const elmJsonVersion: string = elmJsonDependencies[packageIdentifier]

      if (elmJsonVersion !== version.name) {
        throw new Error(`Replace Kernel packages: Expected version ${version.name}
          for ${packageIdentifier} in elm.json, but got: ${String(elmJsonVersion)}`)
      }

      const destinationDir = path.join(
        args.ELM_HOME_PACKAGES,
        user.name,
        package_.name,
        version.name
      )

      // ALL packages in patch archive must have a source.txt file showing
      // where the code was taken from. We use that to see if elm-home/
      // is already patched.
      const sourceFileName = 'source.txt'

      if (
        !fs.existsSync(path.join(destinationDir, sourceFileName)) ||
        fs.readFileSync(path.join(destinationDir, sourceFileName), 'utf-8') !==
          fs.readFileSync(path.join(version.path, sourceFileName), 'utf-8')
      ) {
        prettyInfo('> Running:', "I'll patch this file: ", path.join(destinationDir))
        alreadyUpToDate = false
        // Forces Elm to use the patched files we'll copy soon:
        fs.rmSync(path.join(destinationDir, 'artifacts.dat'), {
          force: true,
        })
      } else {
        prettyInfo('> Running:', "I'll skip patching for file:", path.join(destinationDir))
      }
    }
  }

  // This file contains JavaScript code from Elm packages.
  // If it exists, but doesn't contain code from our elm/virtual-dom
  // package replacement, we must have compiled without the replacements
  // some time. Even if elm-home/ is up-to-date, that won't be used because
  // of this cache file.
  const oDat: string = path.join(args.PROJECT_ELM_STUFF, 'o.dat')
  if (
    alreadyUpToDate &&
    fs.existsSync(oDat) &&
    // This is specific to lydell/virtual-dom: Change as needed if you patch other things.•
    !fs.readFileSync(oDat, 'utf-8').includes('_VirtualDom_createTNode')
  ) {
    alreadyUpToDate = false
  }

  if (!alreadyUpToDate) {
    prettyInfo('> Running: ', 'Patching elm packages in: ', args.ELM_HOME_PACKAGES)
    fs.cpSync(args.PATCH_DIR, args.ELM_HOME_PACKAGES, { recursive: true })
    // Force Elm to recompile everything:
    prettyInfo('> Running: ', 'Invalidate cache fingerprint for: ', args.PROJECT_ELM_STUFF)
    fs.rmSync(args.PROJECT_ELM_STUFF, { force: true, recursive: true })
  }

  if (args.USE_ARCHIVE) {
    prettyInfo('> Running: ', "I'm removing the unarchived patch folder:", args.PATCH_DIR)
    fs.rmSync(args.PATCH_DIR, { force: true, recursive: true })
  }

  prettyInfo('> Done: ', 'Finished successfully\n')
}

/**
 * Parser for elm-json project
 *
 * @param elmJsonPath - path for elm. json
 * @returns - a list of dependencies stated in elm.json
 * @throws error in case of parsing failures
 */
function parseElmJsonDependencies(elmJsonPath: string): Record<string, string> {
  const elmJson = JSON.parse(fs.readFileSync(elmJsonPath, 'utf-8'))
  if (typeof elmJson !== 'object' || elmJson === null) {
    throw new Error('elmJson is not an object.')
  }
  if (typeof elmJson.dependencies !== 'object' || elmJson.dependencies === null) {
    throw new Error('elmJson dependencies field is not an object')
  }
  if (typeof elmJson.dependencies.direct !== 'object' || elmJson.dependencies.direct === null) {
    throw new Error('elmJson dependencies direct field is not an object.')
  }
  if (typeof elmJson.dependencies.indirect !== 'object' || elmJson.dependencies.indirect === null) {
    throw new Error('elmJson dependencies. indirect field is not an object.')
  }

  return { ...elmJson.dependencies.direct, ...elmJson.dependencies.indirect }
}

/**
 * Scans current directory to find members within
 * @param dir - directory path
 * @returns a list of entries child of this directory (excluded hidden files)
 */
function readDir(dir: string): Array<{ name: string; path: string }> {
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith('.')) // Ignore files Like .DS_Store
    .map((name) => {
      return { name, path: path.join(dir, name) }
    })
}
