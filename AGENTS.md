# AGENTS.md

Kilo Code is an open source AI coding agent for VS Code that generates code from natural language, automates tasks, and supports 500+ AI models.

## Mode-Specific Rules

For mode-specific guidance, see the following files:

- **Translate mode**: `.roo/rules-translate/AGENTS.md` - Translation and localization guidelines

## Changesets

Each PR requires a changeset unless it's documentation-only or internal tooling. Create one with:

```bash
pnpm changeset
```

Format (in `.changeset/<random-name>.md`):

```md
---
"kilo-code": patch
---

Brief description of the change
```

- Use `patch` for fixes, `minor` for features, `major` for breaking changes
- For CLI changes, use `"@kilocode/cli": patch` instead

Keep changesets concise but well-written as they become part of release notes.

## Fork Merge Process

Kilo Code is a fork of [Roo Code](https://github.com/RooVetGit/Roo-Code). We periodically merge upstream changes using scripts in `scripts/kilocode/`.

## kilocode_change Markers

To minimize merge conflicts when syncing with upstream, mark Kilo Code-specific changes in shared code with `kilocode_change` comments.

**Single line:**
```typescript
const value = 42 // kilocode_change
```

**Multi-line:**
```typescript
// kilocode_change start
const foo = 1
const bar = 2
// kilocode_change end
```

**New files:**
```typescript
// kilocode_change - new file
```

### When markers are NOT needed

Code in these directories is Kilo Code-specific and doesn't need markers:

- `cli/` - CLI package
- `jetbrains/` - JetBrains plugin
- Any path containing `kilocode` in filename or directory name
- `src/services/ghost/` - Ghost service

### When markers ARE needed

All modifications to core extension code (files that exist in upstream Roo Code) require markers:

- `src/` (except Kilo-specific subdirectories listed above)
- `webview-ui/`
- `packages/` (shared packages)

Keep changes to core extension code minimal to reduce merge conflicts during upstream syncs.

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
