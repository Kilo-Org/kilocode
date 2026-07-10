---
name: conventions
description: Repo style and upstream-hygiene rules for this Kilo/OpenCode fork — naming, no-let, kilocode_change markers, import aliases, test rules.
---

# Conventions (this fork)

## Style (enforced)
- Prefer `const`; avoid `let`, especially with if/else. Use `const x = cond ? a : b` or an `iife`.
- Single-word names for locals/params/helpers (pid, cfg, err, dir, root). Multi-word only if ambiguous.
- Avoid `else` after early return. Avoid empty `catch` (log the error instead).
- Avoid `any`; rely on inference; avoid unnecessary destructuring (`obj.a` not `const { a } = obj`).
- Prefer Bun APIs (`Bun.file`).
- Modules are TypeScript namespaces (Zod schemas + functions), not classes.

## Upstream hygiene (Kilo is a fork of opencode)
- Put Kilo-specific code in `src/kilocode/` or any `kilocode`-named path — no `kilocode_change` markers needed there.
- For shared `packages/opencode/src/**` (non-kilocode) edits: keep minimal, mark with `// kilocode_change` (or start/end block). Do NOT restructure upstream code.
- Run `bun run script/check-opencode-annotations.ts` if touching shared files.

## Import aliases
- `@/*` -> `./src/*`; `@tui/*` -> `./src/cli/cmd/tui/*`.

## Tests
- `bun test test/path.test.ts` from `packages/opencode`. Avoid mocks; test real impl.

## Source links
- After adding URLs in `packages/*/src`, run `bun run script/extract-source-links.ts` (CI checks staleness).
