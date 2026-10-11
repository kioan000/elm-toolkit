// Node strips types but refuses an enum, so this launcher cannot be imported.
enum Mode {
  Fast,
}

export default (): Mode => Mode.Fast
