# AGENTS.md

Kilo Code is an open source AI coding agent for VS Code that generates code from natural language, automates tasks, and supports 500+ AI models.

## Mode-Specific Rules

For mode-specific guidance, see the following files:

- **Translate mode**: `.roo/rules-translate/AGENTS.md` - Translation and localization guidelines

## Code Quality Rules

1. Test Coverage:

    - Before attempting completion, always make sure that any code changes have test coverage
    - Ensure all tests pass before submitting changes
    - The vitest framework is used for testing; the `vi`, `describe`, `test`, `it`, etc functions are defined by default in `tsconfig.json` and therefore don't need to be imported from `vitest`
    - Tests must be run from the same directory as the `package.json` file that specifies `vitest` in `devDependencies`
    - Run tests with: `pnpm test <relative-path-from-workspace-root>`
    - Do NOT run tests from project root - this causes "vitest: command not found" error
    - Tests must be run from inside the correct workspace:
        - Backend tests: `cd src && pnpm test path/to/test-file` (don't include `src/` in path)
        - UI tests: `cd webview-ui && pnpm test src/path/to/test-file`
    - Example: For `src/tests/user.spec.ts`, run `cd src && pnpm test tests/user.spec.ts` NOT `pnpm test src/tests/user.spec.ts`
    - **Test File Naming Convention**:
        - Monorepo default: `.spec.ts` / `.spec.tsx`
        - CLI package exception: `.test.ts` / `.test.tsx` (match existing CLI convention)

2. Lint Rules:

    - Never disable any lint rules without explicit user approval

3. Styling Guidelines:

    - Use Tailwind CSS classes instead of inline style objects for new markup
    - VSCode CSS variables must be added to webview-ui/src/index.css before using them in Tailwind classes
    - Example: `<div className="text-md text-vscode-descriptionForeground mb-2" />` instead of style objects
