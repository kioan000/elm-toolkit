# @elm-toolkit/cli-lib

Utilities shared by the command line tools in this monorepo. The package has no
runtime dependencies and covers three small needs that every one of those tools
runs into.

## Logging that a person can follow

A command line tool reports progress to somebody who is watching the terminal,
so the important lines have to stand out from the rest of the output. The
library provides log helpers that print a highlighted title followed by any
extra values, in three levels of severity.

```ts
import { prettyInfo, prettyWarn } from '@elm-toolkit/cli-lib'

prettyInfo('Building', 'starting webpack')
prettyWarn('Skipping', 'no elm.json in this folder')
```

## Running another program

Tools in this repository often call an external command and want its output to
appear as if the tool had printed it. `spawnCommand` wraps `child_process.spawn`
and connects the input and output streams of the child process to the current
one. It returns a promise, which resolves when the command exits with code zero
and rejects otherwise.

```ts
import { spawnCommand } from '@elm-toolkit/cli-lib'

await spawnCommand('Transpiling in DEV mode', 'yarn', ['webpack', '--mode', 'DEV'])
```

## Knowing where a module stands

A module that is both a library and a command line entry point needs to answer
two questions about itself, and neither answer is easy to write correctly.

The first question is whether the module is the program that Node started, or
whether somebody imported it. A command line tool that parses arguments at
import time runs whenever it is imported, which is rarely what the caller
wanted.

```ts
import { isEntryPoint } from '@elm-toolkit/cli-lib'

if (isEntryPoint(import.meta.url)) {
  program.parse()
}
```

The second question is where the manifest of the package is. Compiled code sits
one directory below its source, so no fixed relative path reaches `package.json`
from both places. `readPackageJson` searches upwards from the module instead.

```ts
import { readPackageJson } from '@elm-toolkit/cli-lib'

program.version(readPackageJson(import.meta.url).version)
```

Both functions take the caller's `import.meta.url`. They cannot use their own,
because the answer is about the calling module and not about this library.

## Requirements

Node 24. The package is compiled to `dist/` and published as JavaScript. The
TypeScript sources are published as well, to support the source maps.

## License

BSD-3-Clause, copyright kioan000.
