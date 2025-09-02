# System Architecture

## Overall Architecture

Kilo Code is structured as a monorepo-based VSCode extension using pnpm workspaces and Turborepo.

## Key Components

- **Core Extension** (`src/`): Extension entry point, message handling, tool implementations
- **API Layer** (`src/api/`): 25+ AI providers with format transformation layer
- **Services** (`src/services/`): Browser automation, code analysis, MCP servers, checkpoints
- **Webview UI** (`webview-ui/`): React-based frontend
- **Integration Layer** (`src/integrations/`): Editor, terminal, file system integration

## Mode System

- **Architect Mode**: Can only edit `.md` files - for documentation and planning
- **Code Mode**: Full file access - primary implementation mode
- **Test Mode**: Focused on test files and testing workflows
- **Debug Mode**: For investigating issues and failures
- **Translate Mode**: Specialized for i18n/localization work
