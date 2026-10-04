/**
 * The ways a call of the Elm compiler can fail, as data that a caller can
 * inspect, and their conversion into a message for a person.
 *
 * Each case of `CompileError` has a `kind` and the facts that explain it: the
 * option that was not known, the compiler that did not start, the messages of a
 * failed build. A tool can react to one case and report the others. To print an
 * error, turn it into a `CliError` of `@elm-toolkit/cli-lib` with `toCliError`,
 * which adds a summary and, where there is one, the next step.
 *
 * @packageDocumentation
 */

import { CliError, type Maybe } from '@elm-toolkit/cli-lib'

/**
 * One failure of a call of the Elm compiler. Read it with a `switch` on `kind`,
 * which must handle every case.
 *
 * @example
 *
 * React to a build that failed, and report everything else
 * ```TypeScript
 *   switch (error.kind) {
 *     case 'compileFailed':
 *       return showInTheBrowser(error.output)
 *     default:
 *       return CliError.print('elm make', CompileError.toCliError(error))
 *   }
 * ```
 */
export type CompileError =
  /** An option that this package does not know; `hint` says what to do instead, for example for an option that Elm 0.19 removed. */
  | { readonly hint: string; readonly kind: 'unknownOption'; readonly option: string }
  /** The compiler binary could not start; `code` is the code of the system, such as ENOENT. */
  | {
      readonly cause: string
      readonly code: Maybe<string>
      readonly kind: 'compilerNotStarted'
      readonly pathToElm: string
    }
  /** Elm ran on `sources` and reported problems; `output` holds the problems, as Elm wrote them. */
  | {
      readonly exitCode: number | null
      readonly kind: 'compileFailed'
      readonly output: string
      readonly sources: ReadonlyArray<string>
    }
  /** The temporary folder for the output of Elm could not be created inside `folder`. */
  | { readonly cause: string; readonly folder: string; readonly kind: 'tempFolderNotCreated' }
  /** The file that the compiler wrote could not be read. */
  | { readonly cause: string; readonly file: string; readonly kind: 'outputNotRead' }
  /** The compiled Elm file has no module of that name; `suggestions` lists the ones it has. */
  | {
      readonly file: string
      readonly kind: 'moduleNotFound'
      readonly moduleName: string
      readonly suggestions: ReadonlyArray<string>
    }
  /** The `init` of the module threw, most often because of flags of the wrong type. */
  | { readonly cause: string; readonly file: string; readonly kind: 'workerNotStarted'; readonly moduleName: string }
  /** The module has no ports, so Node cannot talk to it. */
  | { readonly file: string; readonly kind: 'noPorts'; readonly moduleName: string }
  /** The Elm file to start from could not be read. */
  | { readonly cause: string; readonly file: string; readonly kind: 'entryNotRead' }
  /** The first line of the Elm file is not a valid module declaration. */
  | { readonly file: string; readonly kind: 'invalidModule' }

/**
 * Turns a compile error into an error for a person. The first line names the
 * problem and the file or option involved, "What happened" explains what the
 * call tried and why it failed, and "How to fix" gives one concrete action.
 *
 * @example
 *
 * Print a compiler that is not installed
 * ```TypeScript
 *   CliError.print('elm make', CompileError.toCliError(error))
 *   // ERROR:elm make The Elm compiler "elm" was not found.
 *   //
 *   //     What happened:
 *   //         node-elm-compiler tried to run "elm", and the system found no program with that name or path.
 *   //
 *   //     How to fix:
 *   //         Install Elm in the project with `npm install --save-dev elm`, or set pathToElm to the path of the elm binary.
 * ```
 *
 * @param error - the compile error
 * @returns the same error, described for a person
 */
function toCliError(error: CompileError): CliError {
  switch (error.kind) {
    case 'unknownOption':
      return CliError.create({
        solution: error.hint,
        summary: `Unknown option "${error.option}".`,
        whatHappened: [
          `The options include "${error.option}", which node-elm-compiler does not know.`,
          'An unknown option stops the call, so that a misspelled flag cannot pass unnoticed.',
        ],
      })
    case 'compilerNotStarted':
      return startError(error.pathToElm, error.code.withDefault(''), error.cause)
    case 'compileFailed':
      return CliError.create({
        details: error.output.trim() === '' ? [] : error.output.trim().split('\n'),
        solution:
          'Follow the instructions of the Elm compiler above. They are more precise than any advice of node-elm-compiler.',
        summary: `Could not compile ${error.sources.join(', ')}.`,
        whatHappened: ['The Elm compiler reported an error.'],
      })
    case 'tempFolderNotCreated':
      return CliError.create({
        solution: `Check that ${error.folder} exists, has free space and can be written. To use another folder, set the TMPDIR environment variable.`,
        summary: 'Could not create a temporary folder for the output of Elm.',
        whatHappened: [
          `node-elm-compiler writes the output of Elm into a new folder inside ${error.folder}, and creating it failed.`,
          `The system reported: ${error.cause}`,
        ],
      })
    case 'outputNotRead':
      return CliError.create({
        solution:
          'This is probably a bug of node-elm-compiler. Please report it at https://github.com/kioan000/elm-toolkit/issues, with the message above.',
        summary: 'Could not read the JavaScript that Elm wrote.',
        whatHappened: [
          `Elm compiled without errors and wrote ${error.file}, but reading that file failed.`,
          `The system reported: ${error.cause}`,
        ],
      })
    case 'moduleNotFound':
      return CliError.create({
        solution: moduleNameFix(error.moduleName, error.suggestions, error.file),
        summary: `compileWorker: ${error.file} has no module called "${error.moduleName}".`,
        whatHappened: [
          `compileWorker compiled ${error.file}, then tried to start the module "${error.moduleName}", the name given as moduleName.`,
          error.suggestions.length === 0
            ? `${error.file} has no module with that name.`
            : `${error.file} has only these modules: ${error.suggestions.join(', ')}.`,
        ],
      })
    case 'workerNotStarted':
      return CliError.create({
        solution: `Check the flags passed to compileWorker: they must match the type that the init function of ${error.moduleName} expects.`,
        summary: `compileWorker: the module "${error.moduleName}" failed to start.`,
        whatHappened: [
          `compileWorker compiled ${error.file} and called the init function of "${error.moduleName}", which threw an error.`,
          `Elm reported: ${error.cause}`,
        ],
      })
    case 'noPorts':
      return CliError.create({
        solution: `Declare a port in ${error.file}. See how to declare a port in Elm: https://guide.elm-lang.org/interop/ports.html`,
        summary: 'compileWorker: attempt to compile a worker without ports.',
        whatHappened: [
          `compileWorker compiled ${error.file} and started the module "${error.moduleName}", which declares no ports.`,
          'Node exchanges data with a worker only through ports, so a worker without ports cannot receive input or return a result.',
        ],
      })
    case 'entryNotRead':
      return CliError.create({
        solution: error.cause.startsWith('ENOENT')
          ? `Check the path: no file exists at ${error.file}.`
          : `Check that ${error.file} can be read by this user.`,
        summary: `findAllDependencies: could not read ${error.file}.`,
        whatHappened: [
          `findAllDependencies starts from ${error.file} to list the files it imports, but reading it failed.`,
          `The system reported: ${error.cause}`,
        ],
      })
    case 'invalidModule':
      return CliError.create({
        solution: `Correct the first line of ${error.file}. Run \`elm make ${error.file}\` to see what Elm expects.`,
        summary: `findAllDependencies: ${error.file} does not start with a module declaration.`,
        whatHappened: [
          'The first line of an Elm file declares the module, for example `module Page.Home exposing (view)`.',
          `findAllDependencies reads that line to find the source directory, and the first line of ${error.file} is not a valid declaration.`,
        ],
      })
  }
}

/**
 * Says how to change the module name that `compileWorker` received.
 *
 * @param moduleName - the name that was given
 * @param suggestions - the modules that the file has
 * @param file - the Elm file that was compiled
 * @returns the next step
 */
function moduleNameFix(moduleName: string, suggestions: ReadonlyArray<string>, file: string): string {
  switch (suggestions.length) {
    case 0:
      return `Change moduleName to the name after \`module\` on the first line of ${file}.`
    case 1:
      return `Change moduleName from "${moduleName}" to "${suggestions.join('')}".`

    default:
      return `Change moduleName from "${moduleName}" to one of: ${suggestions.join(', ')}.`
  }
}

/**
 * Describes a compiler that could not start, with the step that fixes the
 * most common causes.
 *
 * @param pathToElm - the binary that was started
 * @param code - the code of the system, such as ENOENT, or an empty string
 * @param cause - the message of the system
 * @returns the error for a person
 */
function startError(pathToElm: string, code: string, cause: string): CliError {
  switch (code) {
    case 'ENOENT':
      return CliError.create({
        solution:
          'Install Elm in the project with `npm install --save-dev elm`, or set pathToElm to the path of the elm binary.',
        summary: `The Elm compiler "${pathToElm}" was not found.`,
        whatHappened: [
          `node-elm-compiler tried to run "${pathToElm}", and the system found no program with that name or path.`,
        ],
      })
    case 'EACCES':
      return CliError.create({
        solution: `Make it executable with \`chmod +x ${pathToElm}\`, then try again.`,
        summary: `The Elm compiler "${pathToElm}" is not allowed to run.`,
        whatHappened: [
          `The file "${pathToElm}" exists, but the system refused to run it, because it is not executable.`,
        ],
      })

    default:
      return CliError.create({
        solution: `Check that "${pathToElm}" is the Elm compiler, and that \`${pathToElm} --version\` works in a terminal.`,
        summary: `The Elm compiler "${pathToElm}" could not start.`,
        whatHappened: [`node-elm-compiler tried to run "${pathToElm}".`, `The system reported: ${cause}`],
      })
  }
}

/**
 * The functions of `CompileError`, under the same name as the type.
 *
 * @example
 *
 * Print any compile error
 * ```TypeScript
 *   CliError.print('elm make', CompileError.toCliError(error))
 * ```
 */
export const CompileError = { toCliError }
