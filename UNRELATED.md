# Unrelated-Change Review: PR #11712

## Scope overview

Reviewed the complete `main...HEAD` diff for PR #11712, all three branch commits (`bf5c163b9e`, `cfd7b13566`, and `7215f577f3`), the PR description, and surrounding context for files whose relationship to Project Stack was not self-evident.

The intended scope is the Project Stack wizard: project technology detection, stack catalog/planning/persistence, marketplace-backed MCP/skill installation, API/SDK integration, VS Code and console UI, technology assets, feature gating, and associated tests. Most of the 307-file diff supports that scope. The findings below identify changes that are unrelated or sufficiently suspicious to require human verification.

## Findings

### UNRELATED-001 — Medium — Repository development environment changes are unrelated to Project Stack

- **References:** `.vscode/tasks.json:23`, `.vscode/tasks.json:42`, `.vscode/tasks.json:61`, `.vscode/tasks.json:80`, `.vscode/tasks.json:97`, `.vscode/tasks.json:115`, `.vscode/tasks.json:139`, `.vscode/tasks.json:161`, `script/kilocode/vscode-bun.sh:1`, `flake.nix:230`
- **Evidence:** The final UI-improvements commit replaces every VS Code Bun task with a new repository-wide `direnv` wrapper, adds that wrapper script, and adds `zig` plus `zig-zlint` to the Nix development shell. Neither the PR body nor the Project Stack implementation requires changing how all repository tasks launch Bun, and the wrapper/zig tooling is not referenced by stack code.
- **Why unrelated or suspicious:** These are broad contributor-environment changes affecting all VS Code watch/install/compile/test/snapshot tasks and all Nix-shell users. They are not limited to building, detecting, configuring, or installing Project Stack resources. Their presence in `feat: project stack ui improvements` suggests local environment setup was bundled into the feature branch.
- **Recommendation:** Remove `.vscode/tasks.json`, `script/kilocode/vscode-bun.sh`, and the `zig`/`zig-zlint` additions from this PR. If needed, submit them separately with their own rationale and platform validation. Preserve only a narrowly demonstrated stack build dependency, if one exists.

### UNRELATED-002 — Low — Release automation formatting is unrelated

- **Reference:** `.kilo/skills/release-jetbrains/script/watch-publish.ts:87`
- **Evidence:** The only change reformats an existing `throw new Error(...)` call in the JetBrains release watcher; it has no semantic effect and no stack dependency.
- **Why unrelated or suspicious:** JetBrains publication automation is outside the Project Stack backend, marketplace, console, and VS Code wizard scope. This is incidental formatter churn in an unrelated operational file.
- **Recommendation:** Revert this file from the PR and keep release-script formatting in a dedicated maintenance change if desired.

### UNRELATED-003 — Low — Unrelated shared-code and test-fixture formatting churn

- **References:** `packages/core/src/project.ts:61`, `packages/kilo-telemetry/src/__tests__/telemetry.test.ts:98`, `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:138`, `packages/opencode/src/cli/cmd/web.ts:36`, `packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-headless-link.tsx:16`, `packages/opencode/src/server/server.ts:115`, `packages/opencode/src/server/server.ts:141`, `packages/opencode/test/server/session-actions.test.ts:59`, `packages/opencode/test/session/llm-native-recorded.test.ts:228`, `packages/opencode/test/fixtures/recordings/kilocode/session/native-anthropic-tool-loop.json:9`, `packages/opencode/test/fixtures/recordings/kilocode/session/native-openai-oauth-tool-loop.json:9`, `packages/opencode/test/fixtures/recordings/kilocode/session/native-zen-tool-loop.json:9`
- **Evidence:** These edits only reflow existing expressions, move `kilocode_change` comments, collapse JSON tag arrays, or delete a trailing blank line. No Project Stack behavior is introduced in these hunks. The actual stack runtime registration in `packages/opencode/src/effect/app-runtime.ts` and stack HTTP integration elsewhere are separate, relevant changes.
- **Why unrelated or suspicious:** The affected files cover project identity, telemetry, generic CLI/TUI output, server listener setup, session tests, and recorded LLM fixtures. Incidental formatting expands the review surface and, in shared upstream-owned files, increases merge-conflict risk without advancing the PR goal.
- **Recommendation:** Revert these formatting-only hunks. Run formatting only on stack-related files or isolate repository-wide formatting in a separate PR. Take particular care to restore existing `kilocode_change` marker placement in shared files.

### UNRELATED-004 — Low — Global checkbox spacing change may exceed wizard scope

- **Reference:** `packages/kilo-ui/src/components/checkbox.css:3`, `packages/kilo-ui/src/components/checkbox.css:24`
- **Evidence:** The PR removes the shared checkbox component's vertical margin and label padding/margin globally. The change is not scoped to Project Stack selectors, even though the final commit is described as stack UI improvements.
- **Why unrelated or suspicious:** This affects every consumer of `@kilocode/kilo-ui` checkboxes, not only the new wizard, and can change established layouts in unrelated screens. It may have been made to fit the wizard design, but the diff provides no stack-specific selector or explanation, so human verification is warranted.
- **Recommendation:** Prefer stack-local CSS overrides in the wizard stylesheet. If the shared spacing is intentionally wrong for all products, move this to a separate UI-system change with regression coverage for existing checkbox consumers.

### UNRELATED-005 — Low — Console loading overlay selector broadening is not clearly tied to Project Stack

- **Reference:** `packages/kilo-console/src/styles/loading.css:19`
- **Evidence:** The selector changes from `.kilo-console .content > .console-loading-content` to `.kilo-console .content .console-loading-content`, causing loading overlays at any descendant depth to receive absolute full-content positioning.
- **Why unrelated or suspicious:** This globally broadens loading behavior throughout the console rather than targeting the new stack route. It may accommodate the wizard's nested loading state, but that dependency is not explicit, and unrelated nested loading components could be affected.
- **Recommendation:** Confirm the stack route requires this rule. If so, scope the selector to the stack container or document/add coverage for the intended generic nesting behavior; otherwise revert it.

## Conclusion

Five findings were identified: one medium-severity group of unrelated development-environment changes and four low-severity groups of unrelated or suspicious formatting/global-style changes. No other scope concerns were found after accounting for the marketplace implementation, generated SDK/OpenAPI updates, source-link regeneration, feature gating, duplicated console/VS Code icon assets, and stack-specific tests as part of the stated Project Stack goal.
