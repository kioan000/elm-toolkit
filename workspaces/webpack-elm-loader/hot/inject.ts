/**
 * Puts the hot reload runtime inside the code that the Elm compiler produced.
 *
 * The runtime has to live inside the Elm wrapper function, because it hooks
 * internal functions of the Elm runtime that no outside code can reach. So the
 * code goes just before the end of that wrapper. An `application` also needs its
 * `Browser.Navigation.Key` tagged, so the runtime can find that key in the model
 * and replace it after a reload.
 *
 * A kernel patched with elm/core#1155 can reload itself: in a development build
 * it exposes `Elm.hot.reload()`. Whether it does is known only when the code
 * runs, because an optimized build still contains that function as dead code.
 * So both ways are injected, and the running code picks one: with `Elm.hot` the
 * new code is handed to `Elm.hot.reload()` and the elm-hot runtime stays off;
 * without it, the elm-hot runtime works as before.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import * as path from 'node:path'

const elm018InitializerSignature = '_elm_lang$core$Native_Platform.initialize'
const elmApplicationSignature = 'elm$browser$Browser$application'
// The build copies the runtime next to the compiled module, so this path also holds in `dist/`.
const hmrRuntimePath = path.join(import.meta.dirname, 'runtime.js')
let cachedRuntimeCode: string | null = null
const moduleSuffixPattern = /(_Platform_export\([^]*)(}\(this\)\);)/
const navKeyPattern =
  /var\s+key\s*=\s*function\s*\(\)\s*{\s*key.a\(\s*(?:impl\.)?onUrlChange\(\s*_Browser_getUrl\(\)\s*\)\s*\);\s*};/
const unsupportedElmVersionMessage =
  '[elm-hot] Elm 0.18 is not supported. Please use fluxxu/elm-hot-loader@0.5.x instead.'
const invalidElmOutputMessage = 'Compiled JS from the Elm compiler is not valid. You must use the Elm 0.19 compiler.'
const navKeyNotFoundMessage = '[elm-hot] Browser.Navigation.Key def not found. Version mismatch?'

// Runs after the Elm wrapper, where `this` is the module's exports and holds `Elm`. On the first run
// it accepts updates; on a later run, the new `Elm` goes to the one that owns the running apps.
const coreHotReload = `
//////////////////// ELM CORE HOT RELOAD BEGIN ////////////////////
if (module.hot && this.Elm && this.Elm.hot) {
  (function (Elm, hot) {
    var running = hot.data && hot.data.Elm;
    if (running) {
      running.hot.reload({ Elm: Elm });
    }
    hot.dispose(function (data) {
      data.Elm = running || Elm;
    });
    hot.accept();
  })(this.Elm, module.hot);
}
//////////////////// ELM CORE HOT RELOAD END ////////////////////
`

/**
 * Returns the compiled Elm code with the hot reload runtime added. Most callers
 * use the loader instead; this function is for other bundlers or for tests.
 *
 * The runtime file is read once and kept in memory for later calls.
 *
 * @example
 *
 * Prepare a compiled bundle for hot reloading
 * ```TypeScript
 *   const compiled = await compileToString('src/Main.elm', { debug: true })
 *   const reloadable = inject(compiled)
 * ```
 *
 * @param originalElmCodeJs - the JavaScript that the Elm 0.19 compiler produced
 * @returns the same JavaScript, with the runtime inside the Elm wrapper
 * @throws an `Error` for output of Elm 0.18, for output that does not end like
 * Elm 0.19 output, and for an application whose navigation key is not found
 */
export function inject(originalElmCodeJs: string): string {
  if (originalElmCodeJs.includes(elm018InitializerSignature)) {
    throw new Error(unsupportedElmVersionMessage)
  }

  const codeWithNavPatch = patchBrowserNavigationKey(originalElmCodeJs)
  const runtimeCode = readElmHotRuntime()
  const match = moduleSuffixPattern.exec(codeWithNavPatch)

  if (!match) {
    throw new Error(invalidElmOutputMessage)
  }

  // The elm-hot runtime stays off when the kernel reloads itself through Elm.hot.
  const elmHotRuntime = `if (!(scope['Elm'] && scope['Elm'].hot)) {\n${runtimeCode}\n}`

  return (
    codeWithNavPatch.slice(0, match.index) +
    match[1] +
    '\n\n' +
    elmHotRuntime +
    '\n\n' +
    match[2] +
    '\n' +
    coreHotReload
  )
}

/**
 * Patch Browser.Navigation.Key creation to tag the key for HMR state restore.
 *
 * @param source - Elm compiler output
 * @returns Source with patched nav key creation when applicable
 *
 * @throws Error
 */
function patchBrowserNavigationKey(source: string): string {
  if (!source.includes(elmApplicationSignature)) {
    return source
  }

  const patched = source.replace(navKeyPattern, appendNavKeyTag)

  if (patched === source) {
    throw new Error(navKeyNotFoundMessage)
  }

  return patched
}

/**
 * Append runtime tag to Browser.Navigation.Key.
 *
 * @param match - Regex match for key definition
 * @returns Patched key definition
 */
function appendNavKeyTag(match: string): string {
  return `${match}\nkey['elm-hot-nav-key'] = true;`
}

/**
 * Read the local Elm HMR runtime source.
 *
 * @returns Runtime source code
 */
function readElmHotRuntime(): string {
  if (cachedRuntimeCode !== null) {
    return cachedRuntimeCode
  }

  cachedRuntimeCode = readFileSync(hmrRuntimePath, { encoding: 'utf8' })

  return cachedRuntimeCode
}
