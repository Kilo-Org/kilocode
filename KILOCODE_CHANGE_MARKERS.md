# KiloCode Change Markers Review

## Scope
- PR: https://github.com/Kilo-Org/kilocode/pull/10387
- Base compared: main
- Files checked: 396

## Findings

### F1
- Severity: high
- File: `packages/opencode/src/provider/provider.ts`
- Lines/symbols: current PR lines 437-475 (`llmgateway`, `openrouter`, `nvidia`, `vercel`), 566-573 (`zenmux`), 842-858 (`cerebras`, `kilo`)
- Suspect marker/change: marker-bearing Kilo provider branding headers from `main` were removed and values reverted from `https://kilo.ai/`, `Kilo Code`, `kilo`, and `KiloCode` to upstream `https://opencode.ai/` / `opencode` values.
- Why it may be wrong: these were explicit `kilocode_change` lines in shared provider code. Losing both the markers and the Kilo values looks like an accidental upstream overwrite, not just a marker move.
- Human verification needed: confirm whether Kilo should still send Kilo-branded referer/title/source/billing headers for llmgateway, openrouter, nvidia, vercel, zenmux, cerebras, and the kilo provider. If yes, restore the Kilo values with markers.

### F2
- Severity: medium
- File: `packages/opencode/src/tool/registry.ts` and `packages/opencode/src/kilocode/tool/registry.ts`
- Lines/symbols: `ToolRegistry` builtin list around current PR lines 219-239; removed `KiloToolRegistry.describe(...) // kilocode_change`; removed `KiloToolRegistry.describe` helper from `packages/opencode/src/kilocode/tool/registry.ts`.
- Suspect marker/change: main wrapped builtin tools with `KiloToolRegistry.describe([...], kilo) // kilocode_change`, and the Kilo helper appended a semantic-search hint to `glob` and `grep` descriptions when semantic search was available. The PR returns the raw builtin list and the helper no longer exists.
- Why it may be wrong: this is both a removed marker in shared code and an apparent loss of Kilo-specific tool-description behavior.
- Human verification needed: confirm whether the semantic-search hint for `glob`/`grep` was intentionally removed. If not, restore the wrapper or move the behavior elsewhere with a marker at the shared callsite.

### F3
- Severity: medium
- File: `packages/opencode/src/session/session.ts`
- Lines/symbols: `createNext`/`create` around current PR lines 500-683; main marker `register attribution before session.created subscribers run` was replaced by post-create `KiloSession.setPlatformOverride` block.
- Suspect marker/change: the marker did not merely move; the behavior changed from registering Kilo session attribution before `sync.run(Event.Created, ...)` to setting the platform override after `createNext` returns.
- Why it may be wrong: main explicitly documented ordering before `session.created` subscribers run. The PR may preserve platform data for later reads, but it may no longer be available to `session.created` subscribers/ingest paths that run during `sync.run`.
- Human verification needed: verify whether any Kilo telemetry/session ingest subscriber depends on the platform override during `session.created`. If yes, restore pre-event registration or add an equivalent pre-event marker.
