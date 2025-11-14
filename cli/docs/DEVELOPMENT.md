## Local development on the CLI

The CLI is currently built by bundling the extension core and replacing the vscode rendering parts with a cli rendering engine. To _develop_ on the CLI you need to follow a few steps:

1. Build the extension core from the root workspace folder by running `pnpm cli:bundle`

2. Change into the cli folder `cd ./cli`

3. Build & run the extension by running `pnpm start:dev`. If you want to use the CLI to work on its own code, you can run `pnpm start:dev -w ../` which will start it within the root workspace folder.

4. While not required, it can be helpful to view log output in a separate terminal. To do this, open a new terminal window and run `pn logs`.

## running tests

`pn test` will test the cli specific code. Many changes require changing the extension code itself, which is tested from the root workspace folder.

## Publishing to npm

TODO: document how to publish versions to npm.

## Debugging

TODO: document how to start debugger if someone figures out how. `console.log` driven development is the soup du jour for now.
