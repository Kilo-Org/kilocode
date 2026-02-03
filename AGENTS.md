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

## Fork Merge Process

Kilo CLI is a fork of [opencode](https://github.com/Kilo-Org/kilo).

### Minimizing Merge Conflicts

We regularly merge upstream changes from opencode. To minimize merge conflicts and keep the sync process smooth:

1. **Prefer `kilocode` directories** - Place Kilo-specific code in dedicated directories whenever possible:
   - `packages/opencode/src/kilocode/` - Kilo-specific source code
   - `packages/opencode/test/kilocode/` - Kilo-specific tests
   - `packages/kilo-gateway/` - The Kilo Gateway package

2. **Minimize changes to shared files** - When you must modify files that exist in upstream opencode, keep changes as small and isolated as possible.

3. **Use `kilocode_change` markers** - When modifying shared code, mark your changes with `kilocode_change` comments so they can be easily identified during merges.

4. **Avoid restructuring upstream code** - Don't refactor or reorganize code that comes from opencode unless absolutely necessary.

The goal is to keep our diff from upstream as small as possible, making regular merges straightforward and reducing the risk of conflicts.

### Kilocode Change Markers

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

#### When markers are NOT needed

Code in these paths is Kilo Code-specific and does NOT need `kilocode_change` markers:

- `packages/opencode/src/kilocode/` - All files in this directory
- `packages/opencode/test/kilocode/` - All test files for kilocode
- Any other path containing `kilocode` in filename or directory name

These paths are entirely Kilo Code additions and won't conflict with upstream.
