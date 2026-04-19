# Terminal Storybook Harness Decision

Date: 2026-04-19

## Spike Outcome: BUILD SUCCEEDS / RENDER INFEASIBLE

The spike (`.storybook/spike-terminal.stories.tsx`) attempted a `require("@opentui/solid")`
inside a Storybook DOM story. Storybook build completed without errors — however rendering
is INFEASIBLE for these reasons:

1. `@opentui/solid` targets a terminal renderer that writes to a TTY via `process.stdout`.
2. Storybook runs under Vite with `browser` resolution conditions. The build may succeed,
   but `@opentui/core` attempts to write escape sequences to stdout — not to a DOM canvas.
3. No visual output would appear in the Storybook preview iframe; only TTY escape codes
   would be emitted (silently swallowed in a browser context).
4. Full terminal rendering requires a real PTY (pseudo-terminal), not a browser sandbox.

## Decision: DOM-Only Storybook + Terminal Stub Strategy

### DOM variants
Full Storybook stories in `src/stories/*.stories.tsx` — wrapping components in
`RenderTargetProvider` with `createDomAdapter()`. These render correctly in Storybook.

### Terminal variants
Phase 3: Terminal branches are **stubs** (plain `<div class="terminal-stub">` elements).
Full terminal implementation is deferred to Phase 5 when the OpenTUI cockpit is rebuilt.
No `@opentui/*` imports in Phase 3 primitives.

Phase 5 option: Text-golden unit tests in `src/hooks/__tests__/*-terminal.test.ts`
asserting serialized element tree matches committed snapshots in
`src/stories/__terminal-snapshots__/`. Full terminal layout can be validated without
requiring a PTY.

## Playwright Visual Regression

`packages/devil-ui/playwright.config.ts` does NOT exist at time of Plan 03-03 execution.
Playwright spec creation is deferred per task instructions. Storybook-only testing is
sufficient for Phase 3.
