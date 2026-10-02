/**
 * The starter files that `--example-elm` and `--example-ts` print.
 *
 * The two examples work together and each one also works alone. The Elm module
 * is called `Main` and sends one message through a `log` port, which is what the
 * runner expects without a launcher. The launcher starts that same module and
 * prints the message with a prefix, so it is easy to see which mode ran.
 *
 * @packageDocumentation
 */

/**
 * A minimal Elm program for the runner, printed by `--example-elm`.
 *
 * @example
 *
 * Create and run a first program
 * ```TypeScript
 *   writeFileSync('src/Main.elm', exampleElm)
 *   // then: elm-node-runner src/Main.elm
 * ```
 */
export const exampleElm = `port module Main exposing (main)

import Platform


port log : String -> Cmd msg


main : Program () () ()
main =
    Platform.worker
        { init = \\_ -> ( (), log "Main application initialized" )
        , update = \\_ model -> ( model, Cmd.none )
        , subscriptions = \\_ -> Sub.none
        }
`

/**
 * A minimal launcher for the program in `exampleElm`, printed by `--example-ts`.
 * It declares the types it uses, so it needs no other package.
 *
 * @example
 *
 * Run the example program through the example launcher
 * ```TypeScript
 *   writeFileSync('src/main.ts', exampleLauncher)
 *   // then: elm-node-runner --ts src/main.ts src/Main.elm
 * ```
 */
export const exampleLauncher = `type Port<Value> = {
  subscribe(listener: (value: Value) => void): void
}

type ElmApp = {
  ports: { log: Port<string> }
}

// One entry for each compiled module, named like the module.
type Elm = {
  Main: { init(): ElmApp }
}

export default (Elm: Elm): void => {
  const app = Elm.Main.init()

  app.ports.log.subscribe((message) => console.log(\`[launcher] \${message}\`))
}
`
