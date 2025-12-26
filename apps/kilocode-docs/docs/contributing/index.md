---
sidebar_position: 1
title: "Contributing to Kilo Code"
---

# Contributing to Kilo Code

Kilo Code is an open-source project that welcomes contributions from developers of all skill levels. This guide will help you get started with contributing to Kilo Code, whether you're fixing bugs, adding features, improving documentation, or sharing custom modes.

## Ways to Contribute

There are many ways to contribute to Kilo Code:

1. **Code Contributions**: Implement new features or fix bugs
2. **Documentation**: Improve existing docs or create new guides
3. **Custom Modes**: Create and share specialized modes
4. **Bug Reports**: Report issues you encounter
5. **Feature Requests**: Suggest new features or improvements
6. **Community Support**: Help other users in the community

## Setting Up the Development Environment

Setting Up the Development Environment is described in details on the [Development Environment](/contributing/development-environment) page.

## Understanding the Architecture

Before diving into the code, we recommend reviewing the [Architecture Overview](/contributing/architecture) to understand how the different components of Kilo Code fit together.

## Development Workflow

### Branching Strategy

- Create a new branch for each feature or bugfix
- Use descriptive branch names (e.g., `feature/new-tool-support` or `fix/browser-action-bug`)

```bash
git checkout -b your-branch-name
```

### Coding Standards

- Follow the existing code style and patterns
- Use TypeScript for new code
- Include appropriate tests for new features
- Update documentation for any user-facing changes

### Commit Guidelines

- Write clear, concise commit messages
- Reference issue numbers when applicable
- Keep commits focused on a single change

### Testing Your Changes

- Run the test suite:
    ```bash
    npm test
    ```
- Manually test your changes in the development extension

### Creating a Pull Request

1. Push your changes to your fork:

    ```bash
    git push origin your-branch-name
    ```

2. Go to the [Kilo Code repository](https://github.com/Kilo-Org/kilocode)

3. Click "New Pull Request" and select "compare across forks"

4. Select your fork and branch

5. Fill out the PR template with:
    - A clear description of the changes
    - Any related issues
    - Testing steps
    - Screenshots (if applicable)

## Creating Custom Modes

Custom modes are a powerful way to extend Kilo Code's capabilities. To create and share a custom mode:

1. Follow the [Custom Modes documentation](/features/custom-modes) to create your mode

2. Test your mode thoroughly

3. Share your mode with the community by submitting a [GitHub Discussion](https://github.com/Kilo-Org/kilocode/discussions)

## Engineering Specs

For larger features, we write engineering specs to align on requirements before implementation. Check out the [Engineering Specs](/contributing/specs) section to see planned features and learn how to contribute specs.

## Documentation Contributions

Documentation improvements are highly valued contributions:

1. Follow the documentation style guide:

    - Use clear, concise language
    - Include examples where appropriate
    - Use absolute paths starting from `/docs/` for internal links
    - Don't include `.md` extensions in links

2. Test your documentation changes by running the docs site locally:

    ```bash
    cd apps/kilocode-docs
    pnpm install
    pnpm start
    ```

3. Submit a PR with your documentation changes

## Community Guidelines

When participating in the Kilo Code community:

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers get started
- Follow the [Code of Conduct](https://github.com/Kilo-Org/kilocode/blob/main/CODE_OF_CONDUCT.md)

## Getting Help

If you need help with your contribution:

- Join our [Discord community](https://kilo.ai/discord) for real-time support
- Ask questions on [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions)
- Visit our [Reddit community](https://www.reddit.com/r/KiloCode)

## Recognition

All contributors are valued members of the Kilo Code community. Contributors are recognized in:

- Release notes
- The project's README
- The contributors list on GitHub

Thank you for contributing to Kilo Code and helping make AI-powered coding assistance better for everyone!
