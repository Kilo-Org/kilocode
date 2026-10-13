# Shared source footprint — September 10, 2026

Production-source footprint: **24 marked source files**. For the complete **54 shared-file** review (including four tests, branding, configuration and two metadata exceptions), see the [current shared-change inventory](v2-current-shared-change-inventory.md). Counts literal `kilocode_change` presence, not occurrences or changed lines. Excludes Kilo-owned packages and kilocode subtrees, tests, documentation and README translations. This is not proof that unmarked changes do not exist.

- `packages/core/src/config.ts`
- `packages/core/src/mcp/index.ts`
- `packages/core/src/plugin/sdk.ts`
- `packages/core/src/plugin/supervisor.ts`
- `packages/core/src/plugin/system-prompt.ts`
- `packages/theme/src/tui/defaults.ts`
- `packages/theme/src/tui/fallback.ts`
- `packages/theme/src/tui/schema.ts`
- `packages/theme/src/tui/types.ts`
- `packages/plugin/src/tui/context.ts`
- `packages/tui/src/app.tsx`
- `packages/tui/src/component/dialog-agent.tsx`
- `packages/tui/src/component/dialog-integration.tsx`
- `packages/tui/src/component/dialog-model.tsx`
- `packages/tui/src/component/prompt/autocomplete.tsx`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/context/local.tsx`
- `packages/tui/src/context/runtime.tsx`
- `packages/tui/src/feature-plugins/sidebar/context.tsx`
- `packages/tui/src/plugin/api.tsx`
- `packages/tui/src/routes/home.tsx`
- `packages/tui/src/routes/session/composer/subagents-tab.tsx`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/src/util/renderer.ts`

Protocol and Server source contain no literal markers. Unmarked differences from the pinned baseline are not counted. Ten direct TypeScript modules exist under `packages/schema/src/kilocode/`; Gateway source has no literal `@opencode-ai/core` imports.

## Annotation coverage follow-up

The upstream-diff audit identified supporting hunks whose annotations were distant, plus an unmarked renderer regression test and `.gitignore` change. Added explanatory annotations at those change sites without altering emitted JavaScript. The production-source count remains **24**; **four** shared test files now carry annotations, and `.gitignore` is annotated as well.

Two shared metadata files remain explicit exceptions:

| File | Why there is no inline marker | Kilo difference to review |
|---|---|---|
| `package.json` | Standard JSON does not support comments. | Kilo extension/dev entrypoints and preserved upstream dev entrypoint; inspect the full diff. |
| `bun.lock` | Generated dependency metadata should not be hand-annotated. | Kilo workspace/dependency resolution; inspect the generated diff. |

Marker presence does not replace an upstream diff review. Added imports and related supporting hunks belong to the same patch even when they are not wrapped in begin/end annotations. Review against the actual consumed upstream ancestor (`59b29de40966803e2c7cd734d439843fb773f6a6` for this checkpoint), rather than treating subsequent upstream evolution after the initial historical pin as Kilo changes.
