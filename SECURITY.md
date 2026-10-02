# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately
through GitHub instead: open the **Security** tab of this repository and choose
**Report a vulnerability**. Only the maintainer can read the report.

Describe the problem, the package and the version it affects, and the steps
that show it. You will get an answer in the same place.

## Scope

The packages run at build time and during development: they compile Elm code,
bundle it with webpack, and patch Elm packages in `ELM_HOME`. A report is most
useful when it shows how one of them can be led to run code, read or write
files, or change `ELM_HOME` in a way that the user did not ask for.

The `eval` port of `elm-node-runner` runs any JavaScript that the Elm program
sends it. This is its documented purpose, not a vulnerability.
