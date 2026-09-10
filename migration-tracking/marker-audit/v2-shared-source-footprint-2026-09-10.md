# Shared source footprint — September 10, 2026

Measured footprint: 24 marked source files plus `AGENTS.md`. Counts literal `kilocode_change` presence, not occurrences or changed lines. Excludes Kilo-owned packages and kilocode subtrees, tests, documentation and README translations. This is not proof that unmarked changes do not exist.

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
