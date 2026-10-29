# Upgrading

This guide lists what to change in your project when you move to a new version
of the toolkit. Each section covers one step between two versions. If you skip
versions, follow every section in between, from the oldest.

The [changelog](CHANGELOG.md) lists everything that changed. This guide covers
only what needs an edit on your side.

## From 0.1.0-alpha.3 to 0.1.0-alpha.4

**If you use the Result API of `node-elm-compiler`**, read the value of an `Ok`
from its field. Every function that starts the compiler now returns an object,
with the details of the run in `details`:

| Function                                  | Before         | Now                             |
| ----------------------------------------- | -------------- | ------------------------------- |
| `compile`                                 | the process    | `{ compilerProcess, details }`  |
| `compileSync`                             | the messages   | `{ details, messages }`         |
| `compileToString`, `compileToStringSync`  | the JavaScript | `{ details, javascript }`       |
| `dryCompile`                              | nothing        | `{ details }`                   |
| `compileRunnableProgram`, `compileWorker` | an object      | the same object, with `details` |

```diff
 const compileToStringResult = await compileToString('src/Main.elm', options)

-compileToStringResult.map((javascript) => writeFileSync('public/main.js', javascript))
+compileToStringResult.map(({ javascript }) => writeFileSync('public/main.js', javascript))
```

```diff
-compile('src/Main.elm', options).map((compiler) => compiler.on('close', onClose))
+compile('src/Main.elm', options).map(({ compilerProcess }) => compilerProcess.on('close', onClose))
```

`compileWorker` takes one record instead of four arguments. The folder of the
project moves to `compilerOptions.cwd`, and the other options of the compiler,
such as `verbose` and `pathToElm`, now work there too:

```diff
-compileWorker('tools', 'src/Generator.elm', 'Generator', { flags: { seed: 42 } })
+compileWorker({
+  compilerOptions: { cwd: 'tools' },
+  moduleName: 'Generator',
+  sources: 'src/Generator.elm',
+  workerArgs: { flags: { seed: 42 } },
+})
```

The old API, at the root of the package, keeps its arguments and returns what
it returned before.

Every error that comes from a run of the compiler now carries `details` too. If
you build one of them yourself, for example in a test, add that field. The
errors of `compileWorker`, `ModuleNotFound`, `ProgramNotLoaded`,
`WorkerNotStarted` and `NoPorts`, name the compiled files in `sources`, a list,
instead of `file`:

```diff
-if (error.type_ === 'NoPorts') console.log(error.file)
+if (error.type_ === 'NoPorts') console.log(error.sources.join(', '))
```

**If you run `elm-node-runner` with `--log-info`**, remove the option. It was
deprecated in 0.1.0-alpha.3, and the runner now refuses it. To see which Elm
binary the build runs, with its flags and folders, use `--verbose`:

```diff
-elm-node-runner --log-info src/Main.elm
+elm-node-runner --verbose src/Main.elm
```

## From 0.1.0-alpha.2 to 0.1.0-alpha.3

Most of this release adds things. A few changes need a small edit on your side:
find the packages you use below. If you only build with webpack, the sections
about the loader and the kernel patcher are the ones for you.

**If you use the hot loader of `webpack-elm-loader`**, remove it. The loader
now adds hot module replacement by itself, and `./hot` is gone:

```diff
-use: [
-  { loader: '@elm-toolkit/webpack-elm-loader/hot' },
-  { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } },
-]
+use: { loader: '@elm-toolkit/webpack-elm-loader', options: { cwd: import.meta.dirname } }
```

Your development builds now contain the hot reloading code, even if you never
used the hot loader. It runs only under the development server. If you do not
want it, set `hotModuleReplacement: false`.

**If you import the options type of the kernel patcher plugin**, use its new
name. The plugin is now called `ElmKernelPatcherPlugin`. It is the default
export, so the import of the class keeps working:

```diff
-import type { ElmKernelReplacementPluginOptions } from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'
+import type { ElmKernelPatcherPluginOptions } from '@elm-toolkit/webpack-elm-kernel-patcher-plugin'
```

**If you set `useArchive`**, remove it, in the plugin or on the command line.
With `useArchive: true`, the default, that is all. With `useArchive: false`, the
patcher used to read a `patches/` folder inside its own package. Move that
folder into your project, and give its path in `patches`, relative to the folder of
`elm.json`:

```diff
-new ElmKernelReplacementPlugin({ isEnabled: true, useArchive: false })
+new ElmKernelPatcherPlugin({ isEnabled: true, patches: 'kernel/patches' })
```

On the command line, `--useArchive false` becomes `--patches kernel/patches`.

**If you use the kernel patcher, check your production builds.** The bundled
patches now include `elm/core`, together with `elm/browser` and
`elm/virtual-dom`. Every build that compiles against the patched Elm home uses
them, production included. A build with `--optimize` leaves out the hot
reloading code, but it still runs on the patched kernel. If you want the
official kernel in production, patch a separate Elm home, in development only:

```js
export default (env, { mode }) => {
  const elmHome = mode === 'development' ? 'elm-home/elm-stuff' : undefined

  return {
    module: {
      rules: [
        {
          test: /\.elm$/,
          use: {
            loader: '@elm-toolkit/webpack-elm-loader',
            options: { cwd: import.meta.dirname, elmHome },
          },
        },
      ],
    },
    plugins: [new ElmKernelPatcherPlugin({ elmHome, isEnabled: mode === 'development' })],
  }
}
```

If the plugin has already run on your machine, delete the `elm-stuff/<version>`
folder of the project before the next production build. Elm reuses the compiled
packages that it keeps there.

**If you call the kernel patcher from code**, switch to `patchKernel`. It does
both steps, and prints the outcome like the command does:

```diff
-replaceKernelPackages(prepareArgs(true, 'frontend'))
+patchKernel({ elmJsonFolder: 'frontend' })
```

If you need to keep the two steps apart, for example to print nothing:
`prepareArgs` now takes one options object, both functions return a `Result`
instead of throwing, and the paths you read are in `PATCHES`. `CURRENT`,
`PATCH_ARCHIVE`, `PATCH_DIR`, and `USE_ARCHIVE` are gone.

```diff
-replaceKernelPackages(prepareArgs(false, 'frontend'))
+const patchResult = prepareArgs({ elmJsonFolder: 'frontend', patches: 'kernel/patches' }).andThen(replaceKernelPackages)
```

**If you call `elm-node-runner` from code**, read a `Result` instead of catching
an error. `compileProgram`, `startMain`, and `runElm` no longer throw:

```diff
-try {
-  await runElm({ elmFiles: ['src/Main.elm'] })
-} catch (error) {
-  console.error(error)
-}
+const runElmResult = await runElm({ elmFiles: ['src/Main.elm'] })
+
+if (runElmResult.type_ === 'Err') {
+  CliError.print(RunnerError.title(runElmResult.error), RunnerError.toCliError(runElmResult.error))
+}
```

A module that the build does not have is now `undefined` in `ElmNamespace`, so
write `Elm.Main?.init()` where you wrote `Elm.Main.init()`.

**Deprecated, but still working.** A later release will remove two things.
You do not have to change them now, but it is a good moment:

- The functions at the root of `node-elm-compiler`. Import them from
  `./result-api` instead, and read a `Result` where you caught an exception. The
  README of the package lists the few functions whose result changed shape.

  ```diff
  -import { compileToString } from '@elm-toolkit/node-elm-compiler'
  +import { compileToString } from '@elm-toolkit/node-elm-compiler/result-api'
  ```

- The `--log-info` option of `elm-node-runner`. Errors now show the messages of
  Elm anyway, so the option only adds the compiler command, and it prints a
  warning. Remove it from your scripts.
