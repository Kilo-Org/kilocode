# Marketplace CLI Migration Follow-up Plan

## Goal

Address the PR review findings for the marketplace migration so the VS Code-to-CLI move preserves existing behavior, improves safety parity, and restores meaningful test coverage.

## Scope

- CLI marketplace implementation under `packages/opencode/src/kilocode/marketplace/`.
- CLI marketplace HTTP handlers under `packages/opencode/src/kilocode/server/httpapi/` only if tests expose endpoint issues.
- VS Code marketplace glue under `packages/kilo-vscode/src/` for type cleanup and install behavior if needed.
- Tests under `packages/opencode/test/kilocode/marketplace/`, `packages/opencode/test/server/`, and existing VS Code unit tests where editor-only behavior remains.

## Decisions

- Keep marketplace business logic in CLI-owned Kilo paths.
- Preserve VS Code legacy MCP cleanup in VS Code for now because it uses VS Code global storage APIs.
- Treat install-time catalog dependency as a behavior decision: prefer a small fallback that accepts the item payload from VS Code only if the CLI cannot resolve the item from catalog; otherwise document and test current behavior. Recommended implementation is to extend the install payload with optional `item` and have the CLI validate `id`/`type` match before using it.
- Restore safe-id behavior from the old VS Code installer exactly, including Windows reserved names and trailing dot checks.

## Implementation Steps

1. Harden marketplace id validation.
   - Update `safe()` in `packages/opencode/src/kilocode/marketplace/installer.ts` to match the old `isSafeId` behavior:
   - Reject empty ids, `.`, ids containing `..`, `/`, `\\`, ids ending with `.`, and Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1-9`, `lpt1-9`).
   - Keep the existing allowed-character regex after those guards.

2. Fix the VS Code install result type.
   - Change `KiloProvider.installMarketplaceItem` from `Promise<RemoveResult>` to `Promise<InstallResult>`.
   - Import `InstallResult` from marketplace types.
   - Confirm no call site depends on the narrower remove result shape.

3. Decide and implement install fallback behavior.
   - Recommended: add optional `item` to the marketplace install payload schema in `packages/opencode/src/kilocode/marketplace/types.ts`.
   - In `Marketplace.install`, first try resolving from `Catalog.all()` as today.
   - If catalog lookup fails and `payload.item` exists with matching `id` and `type`, use `payload.item`.
   - If catalog fetch itself partially fails but still returns unrelated items, preserve the same fallback behavior.
   - Update VS Code install calls (`KiloProvider` and `services/marketplace/actions.ts`) to pass the full marketplace item in addition to `id`/`type`.
   - Regenerate SDK/OpenAPI with `./script/generate.ts` after schema changes.
   - If we decide not to implement fallback, add tests/documentation proving the cold-catalog failure is intentional.

4. Restore installer test coverage in CLI tests.
   - Add/expand tests under `packages/opencode/test/kilocode/marketplace/` for:
   - MCP duplicate rejection.
   - MCP normalization from old local format (`command` + `args` + `env`) to CLI local config.
   - MCP normalization from old remote format (`url` + `headers`) to CLI remote config.
   - MCP selected method via `parameters.__method`.
   - MCP substitution for both `{{key}}` and `${key}` with JSON escaping.
   - Invalid MCP JSON returns structured `success: false` result.
   - Agent successful install writes markdown via `AgentBuilder.save` to `.kilo/agent/<id>.md` and removes stale `kilo.json.agent[id]`.
   - Agent/skill unsafe ids are rejected, including Windows reserved names and trailing dots.
   - Skill duplicate detection across reusable roots.
   - Skill extraction rejects archives missing `SKILL.md`.
   - Skill extraction rejects escaped paths and symlinks pointing outside the extraction root.

5. Add catalog tests.
   - Add a focused test file for `catalog.ts` using a controlled local HTTP server or fetch stub if the repo has an established pattern.
   - Cover parallel partial failures: one failed category still returns successful categories plus `errors`.
   - Cover JSON parsing and YAML fallback.
   - Cover cache behavior: repeated fetch within TTL should not hit the server again.
   - Use `Catalog.clear()` in `afterEach` to avoid cross-test state.

6. Add HTTP API smoke coverage.
   - Add `packages/opencode/test/server/httpapi-kilocode-marketplace.test.ts` or extend an existing Kilo HTTP API test.
   - Cover endpoint response shapes for list/install/uninstall.
   - Cover directory scoping for project operations.
   - Cover that successful install/uninstall returns success and triggers instance disposal/reload behavior if existing test utilities can observe it without brittle sleeps.
   - Avoid duplicating installer internals; assert integration boundaries only.

7. Keep VS Code legacy MCP tests passing.
   - Keep `packages/kilo-vscode/tests/unit/marketplace-actions.test.ts` focused on editor-only cleanup of `.kilo/mcp.json`, `.kilocode/mcp.json`, and VS Code global storage `mcp_settings.json`.
   - Update test mocks only as needed for any payload signature changes.

8. Optional cosmetic cleanup.
   - Consider deleting empty parent objects (`mcp: {}` / `agent: {}`) after removals only if simple and low risk.
   - Do not prioritize this over behavior and tests because current null patch semantics are functionally correct.

## Verification

Run the smallest checks that cover the touched areas:

- From repo root: `./script/generate.ts` if the marketplace install payload schema changes.
- From `packages/opencode/`: targeted marketplace tests, e.g. `bun test ./test/kilocode/marketplace/marketplace.test.ts` and any new marketplace test files.
- From `packages/opencode/`: targeted HTTP API test if added.
- From `packages/opencode/`: `bun run typecheck`.
- From repo root: `bun run script/check-opencode-annotations.ts` because opencode files are touched.
- From `packages/kilo-vscode/`: `bun run typecheck`.
- From `packages/kilo-vscode/`: relevant unit tests for marketplace actions/remove-config-item.

## Expected Outcome

- Marketplace install/uninstall behavior remains equivalent to the old VS Code implementation, with explicit handling of install-time catalog failures.
- Unsafe marketplace ids are rejected with the same protections as before.
- CLI tests cover the business logic now owned by the CLI.
- VS Code tests only cover editor-specific compatibility logic.
- No new performance leaks are introduced; cache and temp-file cleanup remain bounded and tested where practical.
