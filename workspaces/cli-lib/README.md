# @elm-toolkit/cli-lib

Zero-dependency utilities shared by the CLIs in this monorepo.

## What's inside

- **`prettyInfo(title, ...rest)`** — green-background log line for progress/info.
- **`prettyWarn(title, ...rest)`** — yellow-background log line for warnings.
- **`prettyError(title, ...rest)`** — red-background log line for errors.
- **`spawnCommand(logMsg, command, args?, options?)`** — `child_process.spawn`
  wrapper that pipes `stdin`/`stdout`/`stderr` to the parent process and
  resolves/rejects based on the exit code.
- **`sleep(ms)`** — promise wrapper around `setTimeout`.

## Usage

```ts
import { prettyInfo, spawnCommand, sleep } from '@elm-toolkit/cli-lib'

prettyInfo('Building', 'starting webpack…')
await spawnCommand('Transpiling in DEV mode', 'yarn', ['webpack', '--mode', 'DEV'])
await sleep(500)
```

## Requirements

Node `>= 24.15 < 25`. The package is compiled to `dist/` with `tsc -b`; the
TypeScript sources ship alongside it to back the source maps.
