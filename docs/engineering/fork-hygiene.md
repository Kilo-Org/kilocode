# Fork Hygiene

Devil CLI is a fork of upstream OpenCode. Keep the upstream diff small, obvious, and mechanically checkable.

## Placement Rules

- Prefer `packages/opencode/src/devilcode/` for Devil-specific CLI source.
- Prefer `packages/opencode/test/devilcode/` for Devil-specific CLI tests.
- Prefer `packages/devil-*` packages for product-specific Devil behavior.
- Avoid restructuring upstream OpenCode code unless it is required for the task.

## Markers

Use `devilcode_change` for Devil-specific edits in shared OpenCode files under `packages/opencode/`.

Single line:

```ts
const value = 42 // devilcode_change
```

Block:

```ts
// devilcode_change start
const value = 42
// devilcode_change end
```

New file:

```ts
// devilcode_change - new file
```

JSX:

```tsx
{/* devilcode_change */}
```

## Exempt Paths

No marker is needed when a path segment or filename contains `devilcode` or `kilocode`, including:

- `packages/opencode/src/devilcode/`
- `packages/opencode/test/devilcode/`
- Compatibility or migration paths that intentionally retain `kilocode` in the name

## Checks

- Run `bun run script/check-opencode-annotations.ts`.
- Run `bun run standards:check` for broader drift reporting.
- Workflows should target `Devil-Org/devilcode` unless they are intentionally disabled or historical.
