# Development Guide

## Quick Start: Testing the CLI After Contributing

After making changes to the CLI, follow these steps to build and test your changes:

### Step 1: Install Dependencies and Build

From the **repository root** directory:

```bash
# Install all dependencies
pnpm install

# Bundle the CLI (this builds the extension core and CLI together)
pnpm cli:bundle
```

### Step 2: Configure Your Environment

The CLI requires a `.env` file in the `cli/dist` folder with your API credentials:

```bash
# Create the .env file
cat > cli/dist/.env << 'EOF'
# Choose ONE provider configuration:

# Option A: Kilo Code (recommended)
KILO_PROVIDER_TYPE=kilocode
KILOCODE_TOKEN=your-kilo-code-token
KILOCODE_MODEL=anthropic/claude-sonnet-4

# Option B: Anthropic Direct
# KILO_PROVIDER_TYPE=anthropic
# KILO_API_KEY=your-anthropic-api-key
# KILO_API_MODEL_ID=claude-sonnet-4.5

# Option C: OpenAI
# KILO_PROVIDER_TYPE=openai
# KILO_OPENAI_API_KEY=your-openai-api-key
# KILO_OPENAI_MODEL_ID=gpt-4o
EOF
```

> **Note**: Get your Kilo Code API token from [app.kilo.ai](https://app.kilo.ai) on your profile page.

### Step 3: Run the CLI

```bash
# Run the built CLI
node cli/dist/index.js

# Or with a specific workspace
node cli/dist/index.js --workspace /path/to/project

# Or in autonomous mode
node cli/dist/index.js --auto "Your prompt here"
```

### Complete One-Liner

For quick iteration during development:

```bash
pnpm install && pnpm cli:bundle && node cli/dist/index.js
```

---

## Detailed Development Guide

### Local Development on the CLI

We use `pnpm` for package management. Please make sure `pnpm` is installed.

The CLI is currently built by bundling the extension core and replacing the vscode rendering parts with a CLI rendering engine. To _develop_ on the CLI you need to follow a few steps:

1. Build the extension core from the root workspace folder by running `pnpm cli:bundle`

2. Change into the cli folder `cd ./cli`

3. Build & run the extension by running `pnpm start:dev`. If you want to use the CLI to work on its own code, you can run `pnpm start:dev -w ../` which will start it within the root workspace folder.

4. While not required, it's pretty helpful to view log output of the CLI in a separate terminal while you're developing. To do this, open a new terminal window and run `pnpm logs`. You can also run `pnpm logs:clear` to truncate any on-disk logs during development.

### Alternative: Manual Build Steps

If you need more control over the build process:

#### Build the VS Code Extension

```bash
cd src
pnpm bundle
pnpm vsix
pnpm vsix:unpackged
cd ..
```

#### Install CLI Dependencies

```bash
cd cli
pnpm install
pnpm deps:install
```

#### Build the CLI

```bash
pnpm clean
pnpm clean:kilocode
pnpm copy:kilocode
pnpm build
```

#### Configure CLI Settings

```bash
pnpm start config
```

#### Run the Built CLI

```bash
pnpm start
```

---

## Environment Configuration

The CLI can be configured via:

1. **Environment variables** (recommended for testing) - See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)
2. **Config file** - Run `kilocode config` to edit interactively
3. **`.env` file** in the dist folder - Loaded automatically at startup

### Required Environment Variables

At minimum, you need to configure a provider. See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) for all options.

**For Kilo Code provider:**
```bash
KILO_PROVIDER_TYPE=kilocode
KILOCODE_TOKEN=your-token
KILOCODE_MODEL=anthropic/claude-sonnet-4
```

**For Anthropic provider:**
```bash
KILO_PROVIDER_TYPE=anthropic
KILO_API_KEY=your-api-key
KILO_API_MODEL_ID=claude-sonnet-4.5
```

---

## Code Hygiene

`pnpm test` will test the CLI-specific code, though many changes require changing the extension code itself, which is tested from the root workspace folder. We also have `pnpm check-types` and `pnpm lint` for doing type-checking and linting of the CLI-specific code.

### Running Tests

```bash
# From the cli directory
cd cli
pnpm test

# Type checking
pnpm check-types

# Linting
pnpm lint
```

---

## Using DevTools

In order to run the CLI with devtools, add `DEV=true` to your `pnpm start` command, and then run `npx react-devtools` to show the devtools inspector.

---

## Troubleshooting

### "Cannot find module" errors

Make sure you've run `pnpm install` from the repository root, not just the cli folder.

### CLI starts but can't connect to AI

1. Check that your `.env` file exists in `cli/dist/`
2. Verify your API token/key is correct
3. Check the logs: `cd cli && pnpm logs`

### Changes not reflected after rebuild

Make sure you're running `pnpm cli:bundle` from the repository root, not just building the CLI.

---

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
