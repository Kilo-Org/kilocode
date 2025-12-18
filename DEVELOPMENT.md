# Kilo Code Development Guide

Welcome to the Kilo Code development guide! This document will help you set up your development environment and understand how to work with the codebase. Whether you're fixing bugs, adding features, or just exploring the code, this guide will get you started.

## Prerequisites

Before you begin, choose one of the following development environment options:

### Option 1: Native Development (Recommended for MacOS/Linux/Windows Subsystem for Linux)

1. **Git** - For version control
2. **Git LFS** - For large file storage (https://git-lfs.com/) - Required for handling GIF, MP4, and other binary assets
3. **Node.js** (version [v20.19.2](https://github.com/Kilo-Org/kilocode/blob/main/.nvmrc) recommended)
4. **pnpm** - Package manager (https://pnpm.io/)
5. **Visual Studio Code** - Our recommended IDE for development

### Option 2: Devcontainer (Recommended for Windows)

1. **Git** - For version control
2. **Git LFS** - For large file storage (https://git-lfs.com/) - Required for handling GIF, MP4, and other binary assets
3. **Docker Desktop** - For running the development container
4. **Visual Studio Code** - Our recommended IDE for development
5. **Dev Containers extension** - VSCode extension for container development

> **Note for Windows Contributors**: If you're having issues with WSL or want a standardized development environment, we recommend using the devcontainer option. It provides the exact same environment as our Nix flake configuration but works seamlessly on Windows without WSL.

### Option 3: Nix Flake (Recommended for NixOS/Nix users)

1. **Git** - For version control
2. **Git LFS** - For large file storage (https://git-lfs.com/) - Required for handling GIF, MP4, and other binary assets
3. **Nix** - The Nix package manager with flakes enabled
4. **direnv** - For automatic environment loading
5. **Visual Studio Code** - Our recommended IDE for development

## Getting Started

### Installation

#### Native Development Setup

1. **Fork and Clone the Repository**:

    - **Fork the Repository**:
        - Visit the [Kilo Code GitHub repository](https://github.com/Kilo-Org/kilocode)
        - Click the "Fork" button in the top-right corner to create your own copy.
    - **Clone Your Fork**:
        ```bash
        git clone https://github.com/[YOUR-USERNAME]/kilocode.git
        cd kilocode
        ```
        Replace `[YOUR-USERNAME]` with your actual GitHub username.

2. **Setup Git LFS**:

    ```bash
    git lfs install
    git lfs pull
    ```

    This ensures all large files (GIFs, MP4s, etc.) are properly downloaded.

3. **Install dependencies**:

    ```bash
    pnpm install
    ```

    This command will install dependencies for the main extension, webview UI, and e2e tests.

4. **Install VSCode Extensions**:
    - **Required**: [ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - Helps display build errors correctly.

While not strictly necessary for running the extension, these extensions are recommended for development:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - Integrates ESLint into VS Code.
- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - Integrates Prettier into VS Code.

The full list of recommended extensions is [here](https://github.com/Kilo-Org/kilocode/blob/main/.vscode/extensions.json)

#### Devcontainer Setup (Recommended for Windows)

1. **Prerequisites**:

    - Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
    - Install [Visual Studio Code](https://code.visualstudio.com/)
    - Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

2. **Fork and Clone the Repository** (same as above)

3. **Open in Devcontainer**:

    - Open the project in VSCode
    - When prompted, click "Reopen in Container" or use Command Palette: `Dev Containers: Reopen in Container`
    - Wait for the container to build and setup to complete (this may take a few minutes on first run)

4. **Start Development**:
    - All dependencies are automatically installed
    - All recommended VSCode extensions are pre-installed
    - Press F5 to start debugging the extension

#### Nix Flake Setup (Recommended for NixOS/Nix users)

1. **Prerequisites**:

    - Install [Nix](https://nixos.org/download.html) with flakes enabled
    - Install [direnv](https://direnv.net/) for automatic environment loading
    - Install [Visual Studio Code](https://code.visualstudio.com/)
    - (Optional) Install the [mkhl.direnv](https://marketplace.visualstudio.com/items?itemName=mkhl.direnv) VSCode extension for better direnv integration

2. **Fork and Clone the Repository** (same as above)

3. **Setup Development Environment**:

    ```bash
    cd kilocode
    direnv allow
    ```

    The project includes a [`.envrc`](.envrc) file that automatically loads the Nix flake environment when you enter the directory. This provides:

    - Node.js 20 (matching the version in `.nvmrc`)
    - pnpm (via corepack)
    - All other necessary development dependencies

4. **Install Project Dependencies**:

    ```bash
    pnpm install
    ```

5. **Install VSCode Extensions** (same as native development setup above)

6. **Start Development**:
    - Press F5 to start debugging the extension
    - The environment is automatically activated when you enter the project directory
    - No need to manually run `nix develop` - direnv handles this automatically

### Project Structure

The project is organized into several key directories:

- **`src/`** - Core extension code
    - **`core/`** - Core functionality and tools
    - **`services/`** - Service implementations
- **`webview-ui/`** - Frontend UI code
- **`e2e/`** - End-to-end tests
- **`scripts/`** - Utility scripts
- **`assets/`** - Static assets like images and icons

## Development Workflow

### Running the Extension

To run the extension in development mode:

1. Press `F5` (or select **Run** → **Start Debugging**) in VSCode
2. This will open a new VSCode window with Kilo Code loaded

### Hot Reloading

- **Webview UI changes**: Changes to the webview UI will appear immediately without restarting
- **Core extension changes**: Changes to the core extension code will automatically reload the ext host

In development mode (NODE_ENV="development"), changing the core code will trigger a `workbench.action.reloadWindow` command, so it is no longer necessary to manually start/stop the debugger and tasks.

> **Important**: In production builds, when making changes to the core extension, you need to:
>
> 1. Stop the debugging process
> 2. Kill any npm tasks running in the background (see screenshot below)
> 3. Start debugging again

<img width="600" alt="Stopping background tasks" src="https://github.com/user-attachments/assets/466fb76e-664d-4066-a3f2-0df4d57dd9a4" />

### Building the Extension

To build a production-ready `.vsix` file:

```bash
pnpm build
```

This will:

1. Build the webview UI
2. Compile TypeScript
3. Bundle the extension
4. Create a `.vsix` file in the `bin/` directory

### Installing the Built Extension

To install your built extension:

```bash
code --install-extension "$(ls -1v bin/kilo-code-*.vsix | tail -n1)"
```

Replace `[version]` with the current version number.

## Testing

Kilo Code uses several types of tests to ensure quality:

### Unit Tests

Run unit tests with:

```bash
pnpm test
```

This runs both extension and webview tests.

### End-to-End Tests

For more details on E2E tests, see [apps/vscode-e2e](apps/vscode-e2e/).

## Linting and Type Checking

Ensure your code meets our quality standards:

```bash
pnpm lint          # Run ESLint
pnpm check-types   # Run TypeScript type checking
```

## Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) to manage Git hooks, which automate certain checks before commits and pushes. The hooks are located in the `.husky/` directory.

### Pre-commit Hook

Before a commit is finalized, the `.husky/pre-commit` hook runs:

1.  **Branch Check**: Prevents committing directly to the `main` branch.
2.  **Type Generation**: Runs `pnpm --filter kilo-code generate-types`.
3.  **Type File Check**: Ensures that any changes made to `src/exports/roo-code.d.ts` by the type generation are staged.
4.  **Linting**: Runs `lint-staged` to lint and format staged files.

### Pre-push Hook

Before changes are pushed to the remote repository, the `.husky/pre-push` hook runs:

1.  **Branch Check**: Prevents pushing directly to the `main` branch.
2.  **Compilation**: Runs `pnpm run check-types` to ensure typing is correct.
3.  **Changeset Check**: Checks if a changeset file exists in `.changeset/` and reminds you to create one using `npm run changeset` if necessary.

These hooks help maintain code quality and consistency. If you encounter issues with commits or pushes, check the output from these hooks for error messages.

## Troubleshooting

### Common Issues

1. **Extension not loading**: Check the VSCode Developer Tools (Help > Toggle Developer Tools) for errors
2. **Webview not updating**: Try reloading the window (Developer: Reload Window)
3. **Build errors**: Make sure all dependencies are installed with `pnpm install`
4. **Ripgrep missing**: We bundle `@vscode/ripgrep`, but if that binary is missing the extension will fall back to `rg` on your `PATH` (commonly `/opt/homebrew/bin/rg` on macOS) or the path set in `RIPGREP_PATH`.

### Debugging Tips

- Use `console.log()` statements in your code for debugging
- Check the Output panel in VSCode (View > Output) and select "Kilo Code" from the dropdown
- For webview issues, use the browser developer tools in the webview (right-click > "Inspect Element")

### Testing with Local Backend

To test the extension against a local Kilo Code backend:

1. **Set up your local backend** at `http://localhost:3000`
2. **Use the "Run Extension [Local Backend]" launch configuration**:
    - Go to Run and Debug (Ctrl+Shift+D)
    - Select "Run Extension [Local Backend]" from the dropdown
    - Press F5 to start debugging

This automatically sets the `KILOCODE_BACKEND_BASE_URL` environment variable, making all sign-in/sign-up buttons point to your local backend instead of production.

## Contributing

We welcome contributions to Kilo Code! Here's how you can help:

1. **Report an issue** using [GitHub Issues](https://github.com/Kilo-Org/kilocode/issues)
2. **Find an issue** and submit a Pull Request with your fix
3. **Write tests** to improve Code Coverage
4. **Improve Documentation** at [kilo.ai/docs](https://kilo.ai/docs)
5. **Suggest a new feature** using [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions/categories/ideas)!
6. Want to **implement something new**? Awesome! We'd be glad to support you on [Discord](https://discord.gg/Ja6BkfyTzJ)!

## Community

Your contributions are welcome! For questions or ideas, please join our Discord server: https://discord.gg/Ja6BkfyTzJ

We look forward to your contributions and feedback!
