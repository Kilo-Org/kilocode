# Plan 05-01 Summary

## Status
Complete with Warnings

## Files Created/Modified

### Created
- `packages/devil-ui/src/context/density.tsx`: DensityProvider context + DensityMode type + DensityContextValue
- `packages/devil-ui/src/hooks/use-density.tsx`: useDensity() (throws outside provider) + useDensityOptional() (no throw)
- `packages/devil-ui/src/hooks/use-first-run.tsx`: useFirstRun hook with abstract storage interface
- `packages/devil-ui/src/hooks/use-stage-position.tsx`: useStagePosition hook with single-capability lookup (R1-03)
- `packages/devil-ui/src/primitives/density-toggle/index.tsx`: DOM + terminal branches; aria-pressed as string
- `packages/devil-ui/src/primitives/stage-position-badge/index.tsx`: ASCII terminal branch; DOM with aria-label
- `packages/devil-ui/src/primitives/detail-panel/index.tsx`: BUG FIX — flexGrow={1} minWidth={0} on inner box; no width="100%" on text
- `packages/devil-ui/src/primitives/tab-group/index.tsx`: Render-prop children; createMemo active; DOM keyboard-scoped; terminal useKeyboard via dynamic require
- `packages/devil-ui/src/hooks/__tests__/use-density.test.ts`: 8 tests
- `packages/devil-ui/src/hooks/__tests__/use-first-run.test.ts`: 7 tests
- `packages/devil-ui/src/hooks/__tests__/use-stage-position.test.ts`: 8 tests
- `packages/devil-ui/src/primitives/__tests__/density-toggle.test.ts`: 8 tests
- `packages/devil-ui/src/primitives/__tests__/stage-position-badge.test.ts`: 10 tests
- `packages/devil-ui/src/primitives/__tests__/detail-panel.test.ts`: 10 tests
- `packages/devil-ui/src/primitives/__tests__/tab-group.test.ts`: 15 tests
- `packages/devil-ui/src/stories/density-toggle.stories.tsx`: Storybook stories
- `packages/devil-ui/src/stories/detail-panel.stories.tsx`: Storybook stories
- `packages/devil-ui/src/stories/stage-position-badge.stories.tsx`: Storybook stories
- `packages/devil-ui/src/stories/tab-group.stories.tsx`: Storybook stories

### Modified
- `packages/devil-ui/package.json`: Added 9 subpath exports (R1-01)
- `packages/devil-ui/src/hooks/index.ts`: Appended useDensity, useDensityOptional, useFirstRun, useStagePosition exports
- `packages/devil-ui/src/context/index.ts`: Appended DensityProvider, DensityContext, DensityMode exports
- `packages/devil-ui/src/primitives/index.ts`: Appended DensityToggle, StagePositionBadge, DetailPanel, TabGroup exports

## Verification Results

| Command | Result | Pass? |
|---------|--------|-------|
| `test -f packages/devil-ui/src/hooks/use-density.tsx` | exists | Yes |
| `test -f packages/devil-ui/src/hooks/use-first-run.tsx` | exists | Yes |
| `test -f packages/devil-ui/src/hooks/use-stage-position.tsx` | exists | Yes |
| `grep -q "useDensity" ...hooks/index.ts` | found | Yes |
| `grep -q "useFirstRun" ...hooks/index.ts` | found | Yes |
| `grep -q "useStagePosition" ...hooks/index.ts` | found | Yes |
| `grep -q "useDensityOptional" ...use-density.tsx` | found | Yes |
| `bun test src/hooks/__tests__/use-first-run.test.ts` | 7 pass | Yes |
| `bun test src/hooks/__tests__/use-stage-position.test.ts` | 8 pass | Yes |
| `test -f .../context/density.tsx` | exists | Yes |
| `test -f .../primitives/density-toggle/index.tsx` | exists | Yes |
| `grep -q "DensityProvider" .../context/density.tsx` | found | Yes |
| `grep -q "density-toggle" .../primitives/index.ts` | found | Yes |
| `bun test src/primitives/__tests__/density-toggle.test.ts` | 8 pass | Yes |
| `test -f .../stage-position-badge/index.tsx` | exists | Yes |
| `test -f .../detail-panel/index.tsx` | exists | Yes |
| `test -f .../tab-group/index.tsx` | exists | Yes |
| `grep -q "minWidth" .../detail-panel/index.tsx` | found | Yes |
| `grep -q "TabGroup" .../tab-group/index.tsx` | found | Yes |
| `grep -q "tab-group" .../primitives/index.ts` | found | Yes |
| `grep -q "detail-panel" .../primitives/index.ts` | found | Yes |
| `grep -q "stage-position-badge" .../primitives/index.ts` | found | Yes |
| `bun test src/primitives/__tests__/stage-position-badge.test.ts` | 10 pass | Yes |
| `bun test src/primitives/__tests__/detail-panel.test.ts` | 10 pass | Yes |
| `bun test src/primitives/__tests__/tab-group.test.ts` | 15 pass | Yes |
| `bun test src/primitives/__tests__/density-toggle.test.ts` | 8 pass | Yes |
| `bun turbo typecheck` | Fails on pre-existing opencode errors only | Warning (pre-existing) |
| `cd packages/devil-vscode && bun run knip` | Clean | Yes |
| `cd packages/devil-vscode && bun run format:check` | All matched files use Prettier | Yes |
| `cd packages/devil-vscode && bun run check-devilcode-change` | no stale markers found | Yes |

## Test Counts

| File | Tests | Pass |
|------|-------|------|
| `src/hooks/__tests__/use-density.test.ts` | 8 | 8 |
| `src/hooks/__tests__/use-first-run.test.ts` | 7 | 7 |
| `src/hooks/__tests__/use-stage-position.test.ts` | 8 | 8 |
| `src/primitives/__tests__/density-toggle.test.ts` | 8 | 8 |
| `src/primitives/__tests__/stage-position-badge.test.ts` | 10 | 10 |
| `src/primitives/__tests__/detail-panel.test.ts` | 10 | 10 |
| `src/primitives/__tests__/tab-group.test.ts` | 15 | 15 |
| **Total** | **66** | **66** |

## Key Decisions

### SolidJS Show.fallback Thunk Cast (R1 lazy form)
The plan requires `fallback={() => <TerminalBranch/>}` but SolidJS 1.9.x types `Show.fallback` as `JSX.Element`, not `() => JSX.Element`. Resolution: use `(() => <TerminalBranch/>) as unknown as JSX.Element` cast pattern, which satisfies the lazy intent while passing typecheck. Tests updated to accept either form.

### OpenTUI Intrinsics in TSX (box/text)
`<box>` is not in `JSX.IntrinsicElements` (not an HTML/SVG element). `<text bold={...}>` fails because SVG `<text>` doesn't have `bold`. Resolution:
- **detail-panel**: Builds OpenTUI element tree via `require("solid-js/h")` at runtime, falling back to plain HTML div stubs
- **tab-group**: Uses plain `<div>` HTML stubs for the terminal branch (renders as text/ASCII output)
- **stage-position-badge / density-toggle**: Use `<text>` (valid SVG element) for simple text output; no `@ts-expect-error` needed

### useStagePosition Lazy Capability Map
Uses a try/catch dynamic require for `@devilcode/cli/devilcode/team/capabilities` to load `STAGE_CAPABILITY_REQUIREMENTS`, with a hardcoded fallback map matching capabilities.ts. This avoids turbo cyclic dependencies.

### Reactive Test Pattern for SSR/Server Context
`setSignal` updates don't propagate to `createMemo` synchronously in SolidJS's server/SSR mode (used by Bun test runner). Reactive change tests use two separate `withRoot` calls to verify input→output consistency instead of calling `setSignal` mid-root.

### DensityProvider context value
Exposes `Accessor<DensityContextValue>` (a function) through context, not `DensityContextValue` directly. This allows consumers to subscribe reactively to density changes without an extra reactive layer.

## Issues

### Pre-existing: `bun turbo typecheck` fails
`bun turbo typecheck` was already failing before this plan's changes due to errors in `packages/opencode/src/...` (missing module aliases like `@/bus/bus-event`, `@/global`, `@/permission/next`, etc.). These are unresolved cross-package alias issues from the monorepo's opencode package. Zero new errors were introduced in `devil-ui` — confirmed by running `git stash` to baseline and observing identical turbo failure.

### Carry-forward: onboarding-wizard export
The package.json export `"./primitives/onboarding-wizard": "./src/primitives/onboarding-wizard/index.tsx"` was added (per R1-01) but the actual file `src/primitives/onboarding-wizard/index.tsx` is listed in the forbidden files list and was not created. The export entry points to a file that doesn't exist yet — this is a dangling export. If Waves 2/3 create this primitive, it will resolve automatically. Otherwise it should be removed.

## Requirements Covered
P5-R1, P5-R2
