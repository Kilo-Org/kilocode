# Getting Started

This guide will help you set up your development environment and start contributing to
the Kilo Code project.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20.19.2** - Use the exact version specified in `.nvmrc`
- **pnpm** - Package manager (version specified in `package.json`)
- **Git** - Version control system

## Quick Setup

1. **Clone the repository**

    ```bash
    git clone <repository-url>
    cd kilo-code
    ```

2. **Install dependencies**

    ```bash
    pnpm install
    ```

3. **Build the project**

    ```bash
    pnpm build
    ```

4. **Run tests**

    ```bash
    pnpm test
    ```

## Development Workflow

### Building the Project

The project uses Turbo for monorepo management and efficient builds:

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @kilo-code/extension build

# Watch mode for development
pnpm --filter @kilo-code/extension watch:tsc
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @kilo-code/extension test

# Run tests in watch mode
pnpm --filter @kilo-code/extension test --watch
```

### Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format

# Type checking
pnpm check-types
```

### Documentation

```bash
# Build documentation
pnpm docs:build

# Validate documentation
pnpm docs:validate

# Check documentation links
pnpm docs:check-links

# Start documentation development server
pnpm docs:dev
```

## Project Structure

```text
kilo-code/
├── src/                    # Main VS Code extension
├── webview-ui/            # React-based UI
├── packages/              # Shared packages
├── apps/                  # Applications and tools
├── docs/                  # Documentation
└── scripts/               # Build and utility scripts
```

## Next Steps

- Read the [Architecture Overview](../architecture/overview.md) to understand the system design
- Explore the [Build System](./build-system.md) documentation for detailed build information
- Check out the [Testing](./testing.md) guide for testing best practices
- Review the [Contributing](./contributing.md) guidelines before making changes

## Getting Help

- Check the documentation in the `docs/` directory
- Look for existing issues in the project repository
- Ask questions in team communication channels
