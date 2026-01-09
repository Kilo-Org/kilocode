# Development Guide

## Local development on the CLI

We use `pnpm` for package management. Please make sure `pnpm` is installed.

The CLI is currently built by bundling the extension core and replacing the vscode rendering parts with a cli rendering engine. To _develop_ on the CLI you need to follow a few steps:

1. Install dependencies and build the CLI bundle from the root workspace folder:

   ```bash
   pnpm install
   pnpm cli:bundle
   ```

2. Set up your environment file. Copy the sample env file to the CLI dist folder:

   ```bash
   cp .env.sample cli/dist/.env
   ```

   Then edit `cli/dist/.env` to add your API keys (e.g., for OpenRouter, Anthropic, etc.).

3. Change into the cli folder:

   ```bash
   cd ./cli
   ```

4. Build & run the CLI by running `pnpm start:dev`. If you want to use the CLI to work on its own code, you can run `pnpm start:dev -w ../` which will start it within the root workspace folder.

   Alternatively, you can run the CLI directly with:

   ```bash
   node dist/index.js
   ```

5. While not required, it's pretty helpful to view log output of the cli in a separate terminal while you're developing. To do this, open a new terminal window and run `pnpm logs`. You can also run `pnpm logs:clear` to truncate any on-disk logs during development.

### Quick Start (TL;DR)

From the repository root:

```bash
pnpm install
pnpm cli:bundle
cp .env.sample cli/dist/.env
# Edit cli/dist/.env with your API keys
node cli/dist/index.js
```

## Code Hygiene

`pnpm test` will test the cli specific code, though many changes require changing the extension code itself, which is tested from the root workspace folder. We also have `pnpm check-types` and `pnpm lint` for doing type-checking and linting of the CLI specific code.

## Publishing to NPM

- Merge the latest `Changeset version bump` PR to make sure that all changes are included in the CHANGELOG.
- Wait for the `Build CLI Package` job to finish building on `main`.
- When the job is done, an artifact will be attached to the action, download and extract the `.tgz` file inside of it.
- Install the CLI through `npm install -g ./kilocode-cli-1.1.1.tgz`.
- Make sure that the CLI works (Changes in the extension can sometimes conflict with the CLI):
    - A pretty simple manual testing plan you can run locally within the kilocode folder:
        - Make the CLI increase a number in a JSON file.
        - Ask the CLI to describe the `kilocode` project.
    - If you're happy w/ the output then continue to the publish step.
- Run `npm publish` to publish the version after testing is complete.
