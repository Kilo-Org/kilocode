# Generic Code Review: PR #11712

## Overview

PR #11712 adds Project Stack detection, planning, transactional installation/removal, HTTP and SDK endpoints, a standalone VS Code wizard, a prompt-area stack summary, and a matching kilo-console flow. The backend transaction code is generally defensive and has substantial focused coverage, but the review found two CI-blocking issues, one cross-project UI race, one behavior mismatch that prevents supported offline cleanup, and one missing release artifact.

## Findings

### GENERIC-001 — High — Added VS Code test fails because the asserted command is never registered

**References:** `packages/kilo-vscode/tests/unit/stack-panel-arch.test.ts:23`, `packages/kilo-vscode/tests/unit/stack-panel-arch.test.ts:25`, `packages/kilo-vscode/src/extension.ts:370`, `packages/kilo-vscode/package.json:127`

**Evidence / reproduction:** Running:

```sh
cd packages/kilo-vscode
bun test tests/unit/stack-panel-arch.test.ts tests/unit/stack-client.test.ts tests/unit/stack-panel-controller.test.ts tests/unit/stack-state.test.ts
```

produces 35 passing tests and one failure. The architecture test requires `kilo-code.new.sidebarTitle.stackBuilderOpen` in both `src/extension.ts` and `package.json`, but the implementation only registers/contributes `kilo-code.new.stackBuilderOpen`. A repository search finds the sidebar command only in the failing test.

**Expected:** All tests added by the PR pass, and any asserted sidebar toolbar command is contributed and registered.

**Actual:** The focused stack test suite fails deterministically, so CI cannot pass as submitted.

**Recommendation:** Either add and contribute the intended `kilo-code.new.sidebarTitle.stackBuilderOpen` wrapper command (including its menu contribution if the sidebar button is intended), or remove/update the stale assertions if the prompt popover is now the only intended entry point. Run the complete VS Code unit suite afterward.

### GENERIC-002 — High — Shared upstream test change fails the mandatory Kilo annotation guard

**Reference:** `packages/opencode/test/server/session-actions.test.ts:59`

**Evidence / reproduction:** Running:

```sh
bun run script/check-opencode-annotations.ts
```

reports this exact line as an unannotated Kilo change in a shared upstream-owned file. The PR only reformats the existing request expression, but that still changes a guarded shared file and the CI annotation checker rejects it.

**Expected:** Changes under shared `packages/opencode/**` paths either retain the required `kilocode_change` marker or are omitted when unrelated.

**Actual:** The mandatory PR guard exits non-zero.

**Recommendation:** Revert this unrelated formatting-only hunk, or restore an appropriately placed `kilocode_change` annotation. Also avoid including unrelated formatting churn in shared upstream files because it increases merge conflicts.

### GENERIC-003 — Medium — Out-of-order stack-summary requests can display another project's technologies

**References:** `packages/kilo-vscode/src/KiloProvider.ts:436`, `packages/kilo-vscode/src/KiloProvider.ts:440`, `packages/kilo-vscode/src/KiloProvider.ts:457`, `packages/kilo-vscode/src/KiloProvider.ts:526`, `packages/kilo-vscode/webview-ui/src/context/stack-summary.tsx:46`

**Evidence / reproduction:** `fetchAndSendStackSummary()` captures the current directory, awaits `stackClient.load(directory)`, and then unconditionally stores/posts that response. There is no generation token or post-await comparison with `getProjectDirectory()`. Project changes and popover refreshes can start overlapping requests. For example, start a slow request for project A, switch the provider to project B (which starts another request), then let B complete before A. The late A response overwrites `cachedStackSummary` and the webview signals with A's technologies while the chat is on B. The standalone panel controller already uses generation/request tokens, but the summary path does not.

**Expected:** Only the latest request for the provider's current project may update the cached summary and webview.

**Actual:** Network completion order determines the displayed project summary, allowing stale cross-project UI state until another refresh.

**Recommendation:** Add a monotonically increasing request/generation token, or verify after `await` that the captured directory still equals the current project and that the request is latest before caching/posting. Invalidate the generation on project changes and feature disablement, and add a deferred-response race test.

### GENERIC-004 — Medium — Both UIs block offline removal even though the backend explicitly supports it

**References:** `packages/opencode/src/kilocode/stack/planner.ts:356`, `packages/opencode/src/kilocode/stack/service.ts:287`, `packages/opencode/test/kilocode/stack/service.test.ts:314`, `packages/kilo-vscode/webview-ui/src/context/stack.tsx:190`, `packages/kilo-vscode/webview-ui/src/context/stack.tsx:490`, `packages/kilo-console/src/routes/config/StackRoute.tsx:55`, `packages/kilo-console/src/routes/config/state/stack.ts:741`

**Evidence / reproduction:** When the Marketplace is unavailable, the planner always adds a `marketplace_unavailable` conflict. The backend apply path only rejects `invalid_config`, `invalid_draft`, and unavailable selected actions; it deliberately supports applying safe `remove`/`relinquish_modified` actions offline, as demonstrated by the service test "applies preservation and relinquishment while Marketplace is unavailable." However, VS Code's `blocked()` treats every conflict as fatal, and kilo-console similarly disables/returns from confirmation whenever `plan.conflicts.length` is non-zero. Thus the tested backend capability is unreachable from either new UI. Reproduce by configuring a managed stack, modifying or deselecting a resource, making the Marketplace unavailable, previewing, and attempting to confirm: the plan is generated but Confirm/Apply remains disabled.

**Expected:** A plan containing only safe cleanup/preservation actions remains applicable when Marketplace availability is merely informational, while installs and genuinely blocked/missing actions remain disabled.

**Actual:** Any Marketplace outage prevents all UI-driven stack changes, including removal of unchanged managed resources and relinquishment of modified resources.

**Recommendation:** Define blocking conflict codes explicitly in both clients rather than using `conflicts.length`; permit `marketplace_unavailable` when every action is safe without Marketplace data. Keep `blocked`/`missing` actions and invalid draft/config conflicts fatal. Add matching VS Code and kilo-console tests for offline removal/relinquishment.

### GENERIC-005 — Medium — User-facing feature has no changeset

**References:** `packages/kilo-vscode/package.json:127`, `packages/opencode/package.json:1`, `.changeset/README.md:1`

**Evidence / reproduction:** `git diff --name-only main...HEAD -- '.changeset/*'` returns no files. This PR adds a user-visible wizard, new commands/settings, backend/API behavior, and SDK surface across publishable packages. Repository policy requires a changeset for user-facing features, and the PR checklist claims changesets were considered without documenting an exception.

**Expected:** Release tooling receives a minor changeset describing Project Stack from the user's perspective for the affected publishable packages, or the PR records a valid explicit exemption.

**Actual:** The feature will not be represented in package versioning/release notes through the required changeset workflow.

**Recommendation:** Add a concise minor changeset covering the affected released packages (at minimum the CLI and VS Code extension, plus any independently versioned console/SDK package required by repository release policy).

## Validation Notes

- VS Code focused typecheck completed successfully.
- Focused VS Code stack tests produced 35 passes and the deterministic failure in `GENERIC-001`.
- The opencode annotation guard failed as described in `GENERIC-002`.
- Focused backend tests could not start because the workspace installation lacks `@opentui/solid/preload`.
- kilo-console typecheck could not start because `tsgo` is unavailable in the environment.
