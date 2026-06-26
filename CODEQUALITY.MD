# Code Quality Review: PR #11712

## Overview

Reviewed the full `main...HEAD` diff for PR #11712 (307 files, approximately 28.9k additions), including the Effect backend services, Marketplace compatibility layer, Stack catalog/planner/runtime/store, HTTP API and generated SDK, VS Code extension/controller/webview, kilo-console client and state machine, tests, assets, and repository conventions.

The implementation has substantial test coverage and generally keeps new backend behavior in Kilo-owned paths, but the review found six issues. The highest-risk issue can make an apply operation install resources from a Marketplace manifest different from the one the user reviewed. Other findings cover project-config correctness, stale asynchronous UI state, duplicated validation logic, CI/release requirements, and unrelated changes that increase merge risk.

## Findings

### CODEQUALITY-001 — High — Apply can use different Marketplace content than the reviewed plan

- **References:** `packages/opencode/src/kilocode/stack/planner.ts:666`, `packages/opencode/src/kilocode/stack/planner.ts:669`, `packages/opencode/src/kilocode/stack/service.ts:317`, `packages/opencode/src/kilocode/stack/service.ts:329`, `packages/opencode/src/kilocode/stack/service.ts:350`
- **Evidence:** The plan hash includes only `input.marketplace?.revision`, while apply reloads the current manifest, recomputes a plan, checks the hash, and then stages/resolves resources from that newly loaded manifest. `Marketplace.verify` prevents mutation relative to this process's cache, but the Stack API itself does not bind the reviewed plan to the manifest item fingerprints. A fresh process/cache, cache loss, endpoint change, or legacy manifest source can therefore return altered item templates/artifacts under the same revision and still produce the same Stack `plan_hash` if actions and user-visible warnings remain unchanged.
- **Consequence:** A user can review one MCP command/template or skill artifact and apply another. This undermines the exact-plan confirmation and stale-plan safety boundary, and is especially risky because apply installs executable skills and MCP commands.
- **Recommendation:** Include `manifestFingerprint(manifest)` and/or the digest/fingerprint of every relevant Marketplace item in the canonical plan-hash input. Persist those fingerprints on the plan and reject apply when the reloaded manifest differs. Add an integration test that previews with manifest A, applies with altered manifest B using the same revision, and expects `stale_plan`.

### CODEQUALITY-002 — High — Stack persistence ignores the project's active config file

- **References:** `packages/opencode/src/kilocode/stack/store.ts:186`, `packages/opencode/src/kilocode/stack/store.ts:207`, `packages/opencode/src/config/config.ts:835`, `packages/opencode/src/config/config.ts:838`
- **Evidence:** `StackStore.target()` always reads and writes `<worktree>/.kilo/kilo.jsonc`. The normal config loader discovers root and ancestor `kilo.json[c]`/`opencode.json[c]` files and merges them. As a result, the service can report an empty Stack even when effective project config already contains `stack`, and apply can silently create a second, higher-precedence config instead of updating the user's existing config source. The same issue applies to MCP inventory because `Snapshot.mcp` only reflects the hard-coded file.
- **Consequence:** Existing selections and managed receipts can be ignored, duplicate project configuration can be introduced, and MCP ownership/drift decisions can be made against an incomplete view. Users may see inconsistent state between the wizard, effective config, and source files.
- **Recommendation:** Reuse the established project-config source/overlay resolution (`KilocodeConfig`, `ConfigPaths`, or the config overlay service) to select the active writable project file and obtain effective/local MCP state. If Stack is intentionally isolated to `.kilo/kilo.jsonc`, reject or explicitly migrate conflicting `stack` declarations from other project config files and document/test the precedence behavior.

### CODEQUALITY-003 — Medium — Stack summary requests can publish stale project data

- **References:** `packages/kilo-vscode/src/KiloProvider.ts:435`, `packages/kilo-vscode/src/KiloProvider.ts:437`, `packages/kilo-vscode/src/KiloProvider.ts:455`, `packages/kilo-vscode/src/KiloProvider.ts:522`, `packages/kilo-vscode/src/KiloProvider.ts:526`
- **Evidence:** `fetchAndSendStackSummary()` captures a directory, awaits two backend requests, and unconditionally writes `cachedStackSummary` and posts the result. `setProjectDirectory()` starts another request but does not cancel or generation-check the previous one. A slower request for project A can complete after a faster request for project B and overwrite the cache/webview with A's technologies. Unlike `StackPanelController`, this path has no request token or directory check after awaiting.
- **Consequence:** The chat popover can display and cache technologies from the wrong workspace, which is misleading in multi-root, tab, and Agent Manager workflows.
- **Recommendation:** Add a monotonically increasing request generation or compare the captured directory with `getProjectDirectory()` before mutating/posting. Prefer a typed `StackSummaryLoadedMessage` cache over `unknown` plus casts. Add a deferred-promise race test proving an old project response is discarded.

### CODEQUALITY-004 — Medium — MCP validation and rendering are duplicated in the planner

- **References:** `packages/opencode/src/kilocode/stack/planner.ts:190`, `packages/opencode/src/kilocode/stack/planner.ts:197`, `packages/opencode/src/kilocode/stack/planner.ts:219`, `packages/opencode/src/kilocode/stack/planner.ts:224`, `packages/opencode/src/kilocode/marketplace/mcp.ts:173`, `packages/opencode/src/kilocode/marketplace/mcp.ts:195`, `packages/opencode/src/kilocode/marketplace/mcp.ts:203`, `packages/opencode/src/kilocode/marketplace/mcp.ts:217`
- **Evidence:** `Planner.validate()` independently reimplements parameter validation, URL security, placeholder substitution, template rendering, defaults, and MCP fingerprinting that already exist in `Marketplace.resolveMcp()`. Preview uses the planner copy, while apply later calls the Marketplace implementation. The copies already differ in structure and validation coverage, so future Marketplace changes can make preview accept a configuration that apply rejects or compute a different fingerprint.
- **Consequence:** The review screen can drift from execution behavior, causing late apply failures and creating a security-sensitive maintenance burden across two implementations.
- **Recommendation:** Extract a shared pure MCP resolver/validator that returns the resolved config plus warnings/prerequisites, then wrap it with Effect errors in Marketplace. Use that single implementation from both planner and apply. Add a parity/property test over all built-in manifest methods asserting preview resolution and Marketplace resolution produce the same config/fingerprint or the same rejection.

### CODEQUALITY-005 — Medium — Required repository release and annotation checks are not satisfied

- **References:** `packages/opencode/test/server/session-actions.test.ts:59`, `packages/kilo-vscode/package.json:127`, `packages/kilo-vscode/package.json:938`, `packages/opencode/src/config/config.ts:230`, `.changeset/README.md:5`
- **Evidence:** Running `bun run script/check-opencode-annotations.ts` fails on the changed line in the shared upstream test because it lacks a `kilocode_change` marker. The PR also adds a user-facing Project Stack command, extension UI, API, and config key but changes no file under `.changeset/`. Repository guidance requires changesets for user-facing features.
- **Consequence:** The annotations CI guard fails, and the feature may ship without package version bumps or release notes. The unannotated shared-file edit also creates avoidable upstream merge churn.
- **Recommendation:** Revert the formatting-only shared test change or annotate it correctly. Add a minor changeset for the user-facing packages (at minimum `@kilocode/cli` and `kilo-code`, plus any independently released console package as applicable) with a concise user-facing description. Run the annotation and changeset checks before merge.

### CODEQUALITY-006 — Low — The PR contains unrelated formatting and development-environment changes

- **References:** `.kilo/skills/release-jetbrains/script/watch-publish.ts:87`, `.vscode/tasks.json:23`, `flake.nix:230`, `packages/core/src/project.ts:61`, `packages/kilo-telemetry/src/__tests__/telemetry.test.ts:99`, `packages/kilo-ui/src/components/checkbox.css:4`, `packages/opencode/src/cli/cmd/web.ts:36`, `packages/opencode/test/server/session-actions.test.ts:59`
- **Evidence:** The branch changes JetBrains release-script formatting, VS Code task command wrappers, Nix development tools, shared core marker formatting, telemetry whitespace, global checkbox spacing, web-command formatting, and an unrelated session test. These changes are not needed by Project Stack; several are formatting-only, while the checkbox change affects every consumer of the shared component.
- **Consequence:** The already large review becomes harder to reason about, regressions can be attributed to the wrong feature, shared/upstream merge conflicts increase, and the global checkbox layout change can alter unrelated UI.
- **Recommendation:** Remove unrelated edits from this PR and land intentional task/Nix/checkbox changes separately with focused rationale and tests or visual baselines. Keep shared upstream changes to the minimum required Kilo integration points.

## Validation Notes

- `packages/kilo-vscode`: `bun run typecheck` passed.
- `packages/kilo-vscode`: `bun run check-kilocode-change` passed.
- Root annotation guard failed as described in `CODEQUALITY-005`.
- Focused backend and kilo-console tests could not run in this checkout because required installed dependencies/preloads were unavailable (`@opentui/solid/preload`, `@kilocode/sdk/v2/client`, and `solid-js`).
- CLI typecheck and VS Code `knip` could not run because `tsgo` and `knip` were unavailable in the environment.
