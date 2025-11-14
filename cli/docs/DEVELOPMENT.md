## Local development on the CLI

We use `pnpm` for package management. Please make sure `pnpm` is installed.

The CLI is currently built by bundling the extension core and replacing the vscode rendering parts with a cli rendering engine. To _develop_ on the CLI you need to follow a few steps:

1. Build the extension core from the root workspace folder by running `pnpm cli:bundle`

2. Change into the cli folder `cd ./cli`

3. Build & run the extension by running `pnpm start:dev`. If you want to use the CLI to work on its own code, you can run `pnpm start:dev -w ../` which will start it within the root workspace folder.

4. While not required, it's pretty helpful to view log output of the cli in a separate terminal while you're developing. To do this, open a new terminal window and run `pnpm logs`. You can also run `pnpm logs:clear` to truncate any on-disk logs during development.

## Code Hygiene

`pnpm test` will test the cli specific code, though many changes require changing the extension code itself, which is tested from the root workspace folder. We also have `pnpm check-types` and `pnpm lint` for doing type-checking and linting of the CLI specific code.

## Publishing to NPM

## Debugging

TODO: document how to start debugger if someone figures out how. `console.log` driven development is the soup du jour for now.
