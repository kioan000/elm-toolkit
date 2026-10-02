type Elm = Record<
  string,
  {
    init(options?: { flags?: unknown }): { ports: { greeting: { subscribe(listener: (value: string) => void): void } } }
  }
>

export default (Elm: Elm): void => {
  console.log(`modules: ${Object.keys(Elm).sort().join(',')}`)

  const app = Elm.Greeter.init({ flags: 'launcher' })

  app.ports.greeting.subscribe((message) => console.log(message))
}
