# AGENTS.md

Kilo CLI is an open source AI coding agent that generates code from natural language, automates tasks, and supports 500+ AI models.

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

### Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

### Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

## Fork Architecture

Kilo CLI is a rebranded fork of [opencode](https://github.com/sst/opencode). We regularly merge upstream changes.

### Branding

- "Kilo CLI" replaces "OpenCode" in ALL user-facing strings
- Upstream uses `opencodeZen` as their gateway provider; we use `kiloGateway`
- The `kilo` provider must be FIRST in `preferredProviders` array

### Package Names

| Upstream              | Kilo                  | Notes                 |
| --------------------- | --------------------- | --------------------- |
| `opencode`            | `@kilocode/cli`       | Root package          |
| `@opencode-ai/plugin` | `@kilocode/plugin`    |                       |
| `@opencode-ai/sdk`    | `@kilocode/sdk`       |                       |
| `@opencode-ai/script` | `@opencode-ai/script` | Keep as-is (internal) |
| `@opencode-ai/util`   | `@opencode-ai/util`   | Keep as-is (internal) |
| Binary: `opencode`    | Binary: `kilo`        |                       |

### Kilo-Specific Packages (not in upstream)

- `@kilocode/kilo-gateway` - Kilo Gateway provider
- `@kilocode/kilo-telemetry` - Telemetry package

### Kilo-Specific Directories (no markers needed)

- `packages/opencode/src/kilocode/` - Kilo-specific source code
- `packages/opencode/test/kilocode/` - Kilo-specific tests
- `packages/kilo-gateway/` - Kilo Gateway package
- `packages/kilo-telemetry/` - Telemetry package

### Minimizing Merge Conflicts

1. **Prefer `kilocode` directories** - Place Kilo-specific code in dedicated directories
2. **Minimize changes to shared files** - Keep changes small and isolated
3. **Use `kilocode_change` markers** - Mark changes in shared code (see below)
4. **Avoid restructuring upstream code** - Don't refactor unless necessary

### Kilocode Change Markers

Mark Kilo-specific changes in shared code with `kilocode_change` comments:

```typescript
// Single line
const value = 42 // kilocode_change

// Multi-line block
// kilocode_change start
const foo = 1
const bar = 2
// kilocode_change end

// New file (at top of file)
// kilocode_change - new file
```

**When markers are NOT needed:** Any path containing `kilocode` in filename or directory name.

### Critical Files (never accept upstream)

| File                                                   | Reason                             |
| ------------------------------------------------------ | ---------------------------------- |
| `packages/opencode/src/cli/logo.ts`                    | Kilo ASCII art logo                |
| `packages/opencode/src/cli/ui.ts`                      | Kilo logo reference                |
| `packages/opencode/src/cli/cmd/tui/component/logo.tsx` | KiloLogo component                 |
| `packages/app/src/hooks/use-providers.ts`              | `kilo` first in preferredProviders |
| `packages/app/src/i18n/*.ts`                           | kiloGateway keys, Kilo branding    |
| `package.json` (root)                                  | `"name": "@kilocode/cli"`          |

### Files to Accept from Upstream (no Kilo changes)

```
packages/desktop/*                    # Entire Tauri desktop app
nix/desktop.nix                       # Nix desktop build
.github/workflows/nix-desktop.yml     # Desktop CI
```

### Upstream Merge

To merge upstream changes, load the `upstream-merge` skill which has the full process and scripts.
