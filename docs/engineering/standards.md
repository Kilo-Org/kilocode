# Standards

These are agent-facing coding and review standards. Add mechanical checks when a rule becomes important enough to enforce.

## TypeScript Style

- Prefer `const` over `let`.
- Prefer early returns over `else`.
- Keep logic in one function unless extraction removes real complexity or creates reuse.
- Avoid unnecessary destructuring; `obj.value` often preserves context better.
- Avoid `any`.
- Rely on inference unless exported types or clarity require annotations.
- Use short single-word names when clear: `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `pid`.
- Use Bun APIs when they fit.
- Do not leave empty `catch` blocks.

## Tests

- Prefer testing real implementation paths over mocks.
- Add focused tests for new behavior, broader tests for shared contracts.
- After code changes, run the relevant tests before considering the task done.

## Frontend

- Follow existing SolidJS and component patterns.
- In `packages/devil-vscode/`, use `@devilcode/kilo-ui` components where available.
- In `packages/app/`, use `createStore` instead of many independent `createSignal` calls.
- UI changes should include visual verification when practical.

## Commits

Use Conventional Commits:

- `feat:`
- `fix:`
- `refactor:`
- `test:`
- `docs:`
- `chore:`

Scopes should match packages when a change is package-specific.
