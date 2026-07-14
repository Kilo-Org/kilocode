# Broken Kilo Pipeline Chains: PR #12204

## Scope and method

Audited checked-out HEAD `472247daa9063cf7dfea423bec64c46cea44ba36` against base `c49560af0f94459015d3fa4e1efa23ad9b291955`. The comparison is a 972-file upstream integration, including extraction of the interactive TUI from `packages/opencode/src/cli/cmd/tui/` into `packages/tui/` and movement of server/SDK contracts.

The audit inventoried files whose `kilocode_change` regions changed or disappeared, inspected the Kilo compatibility commits, and traced affected behavior from its producer through schemas/types, service state, event envelopes, config/flags, handlers and SDK data into the final consumer. Findings below are limited to broken or suspicious end-to-end chains; this is not an exhaustive marker checklist.

## Findings

### High: anonymous Kilo provider again marks the TUI as connected

The base Kilo customization excluded both anonymous auto-loaded providers, `opencode` and `kilo`, unless they exposed a non-zero-cost model (`c49560a:packages/opencode/src/cli/cmd/tui/component/use-connected.tsx:6-10`). During package extraction, the moved consumer retained only upstream's `opencode` exception: `packages/tui/src/component/use-connected.tsx:4-11` returns true for any `kilo` provider solely because its id differs from `opencode`.

The broken chain is provider bootstrap -> `config.providers` -> `SyncProvider`'s `provider` store (`packages/tui/src/context/sync.tsx:783-810`) -> `useConnected()` -> onboarding consumers. For an anonymous Kilo catalog that does not itself prove authentication, the final state now suppresses the rotating `/connect` prompt (`packages/tui/src/routes/session/footer.tsx:32-50`), removes the suggested status from `/connect` (`packages/tui/src/app.tsx:738-746`), enables the model dialog's connected-only extras (`packages/tui/src/component/dialog-model.tsx:23-35`), and may show provider checkmarks (`packages/tui/src/component/dialog-provider.tsx:76-82,140`). This compiles because the provider shape is unchanged; only the Kilo interpretation was dropped.

Action: restore the `provider.id !== "kilo"` exclusion in the extracted `useConnected` predicate and add a focused test with an anonymously auto-loaded Kilo provider, plus authenticated/non-zero-cost and ordinary-provider controls.

### Medium: dismissed-question metadata reaches the TUI but no longer controls its presentation

The backend chain remains intact: a superseding prompt calls `Question.dismissAll`; `KiloQuestionTool.catchDismissed` converts `QuestionRejectedError` to a normal result and sets `metadata.dismissed = true` with `answers = []` (`packages/opencode/src/kilocode/tool/question.ts:13-26`); the shared tool preserves the metadata type and returns that result (`packages/opencode/src/tool/question.ts:11-14,24-37`); and `SessionProcessor` persists output metadata into the completed tool part (`packages/opencode/src/session/processor.ts:293-306`).

The final moved consumer is only partially wired. It computes `dismissed`, a dismissed title, and a dismissed subtitle (`packages/tui/src/routes/session/index.tsx:2816-2834`), but renders whenever `answers()` is present with a hard-coded `# Questions` title (`packages/tui/src/routes/session/index.tsx:2837-2852`). The computed `title` and `subtitle` have no consumer, and the base Kilo click-to-expand/collapse interaction was removed (`c49560a:packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2901-2958`). The result still says `Dismissed` in each row, but users silently lose the explicit dismissed heading and the compact, expandable one-line result.

Action: restore the Kilo collapsed/expanded rendering around the new unknown-safe parsers, use `title()`/`subtitle()`, and test pending, answered, dismissed, and error-shaped legacy parts.

### Medium: Edit tool diff metadata no longer reaches the Kilo multi-hunk renderer

The producer still creates a unified diff, publishes it as permission metadata, and persists it as tool metadata (`packages/opencode/src/tool/edit.ts:170-187,210-233`). The moved TUI still imports `splitDiffHunks`, and Apply Patch still splits each file diff and inserts visual separators (`packages/tui/src/routes/session/index.tsx:2713-2750`). The Edit consumer, however, now passes the entire metadata diff to one `<diff>` element (`packages/tui/src/routes/session/index.tsx:2647-2688`). This removed the affected Kilo customization that split Edit output into individual hunks with `...` separators (`c49560a:packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2735-2774`).

This is a silent display regression: metadata, SDK types, and component props all remain valid, so compilation cannot detect that only one of the two edit-like renderers retained the Kilo presentation behavior.

Action: apply the existing local `Diff`/`splitDiffHunks` rendering pattern to `Edit`, and add a renderer snapshot with two non-adjacent hunks. Human terminal verification is warranted because OpenTUI's behavior for a multi-hunk string can vary by renderer version.

### Low: the subagent startup state lost its final text consumer

The task part still carries its description and child session id, and the TUI still derives child status and tool calls. In the base consumer, a running child with no tool calls appended `↳ Starting...` (`c49560a:packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2666-2672`). The extracted consumer handles retries and active tool calls but has no no-tools-running branch (`packages/tui/src/routes/session/index.tsx:2579-2603`). Until the first child tool appears, only the generic spinner/pending label remains (`packages/tui/src/routes/session/index.tsx:2608-2626`).

Action: restore the final `else if (isRunning())` branch and cover a child session that is busy before its first tool event. This is lower severity because the spinner still indicates activity, but the explicitly customized startup detail was lost.

## Human verification required

### Experimental session switcher flag and preview chain was deleted

At the base, `KILO_EXPERIMENTAL_SESSION_SWITCHER` was defined in `packages/core/src/flag/flag.ts:95`, consumed by the internal TUI registry at `packages/opencode/src/cli/cmd/tui/plugin/internal.ts:72`, and selected the plugin whose `session.list` command opened `SessionSwitcherDialog`. That dialog propagated focus through a leading/trailing signal into `SessionPreviewPane`, which fetched or reused session messages (`c49560a:packages/opencode/src/cli/cmd/tui/feature-plugins/session/index.tsx:1-32`; `c49560a:packages/opencode/src/cli/cmd/tui/feature-plugins/session/preview-pane.tsx:1-77`).

HEAD has neither the flag nor those plugin files; `packages/core/src/flag/flag.ts:113-121` contains the separate `KILO_EXPERIMENTAL_SESSION_SWITCHING` flag only. The always-available standard dialog now has substantial worktree/search behavior, but it has no preview pane (`packages/tui/src/component/dialog-session-list.tsx:21-62,228-240`). Confirm with the feature owner whether the experimental preview was intentionally retired. If not, restore the flag -> registry -> plugin -> focused-session preview chain in the standalone package. The deleted Kilo scheduling regression test was also reduced to testing only `createDebouncedSignal`, so it no longer protects this behavior.

### Experimental event-system debug route receives a flag that no registry consumes

`RuntimeFlags` still resolves `KILO_EXPERIMENTAL_EVENT_SYSTEM` (`packages/opencode/src/effect/runtime-flags.ts:44-52`), plugin startup still passes it through `internalTuiPlugins`, and that function passes it to `createBuiltinPlugins` (`packages/opencode/src/plugin/tui/internal.ts:7-13`). The standalone factory accepts the option but never reads it (`packages/tui/src/feature-plugins/builtins.ts:21-35`). At the base, true appended `internal:session-v2-debug`, whose `session.v2.messages` command and route rendered v2 messages (`c49560a:packages/opencode/src/cli/cmd/tui/plugin/internal.ts:71`; `c49560a:packages/opencode/src/cli/cmd/tui/feature-plugins/system/session-v2.tsx:34-35,1190-1227`).

The ordinary v2 data path is now integrated elsewhere, so deletion may be intentional, but the surviving unused parameter strongly resembles an incomplete merge resolution. Confirm whether the debug route is obsolete; then either remove the dead option from the registry API or restore the conditional plugin and its Kilo dismissed-question behavior.

## Notable non-findings

- Kilo internal TUI plugins survived extraction: `withKiloTuiPlugins` prepends all 15 Kilo modules (`packages/opencode/src/kilocode/plugins/internal.ts:18-37`), the shared hook invokes it (`packages/opencode/src/plugin/tui/internal.ts:7-14`), and `packages/opencode/test/kilocode/tui-plugin-registry.test.ts:4-29` pins ids, order, and uniqueness.
- Stateful slot fallback and reactive props were repaired end to end. `packages/tui/src/plugin/slots.tsx:25-38` resolves fallback children once while forwarding merged reactive props, with coverage in `packages/opencode/test/kilocode/slot-prop-reactivity.test.ts` and `packages/tui/test/plugin/slots.test.tsx`.
- Legacy and versioned event paths both remain connected. `EventV2Bridge` encodes events and emits legacy plus sync envelopes; the TUI normalizes and project-filters both (`packages/tui/src/context/event.ts:63-105`), then applies v1 sync projections (`packages/tui/src/context/sync.tsx:622-740`). The focused event tests include cross-project rejection and cross-worktree persistent-process acceptance (`packages/opencode/test/kilocode/tui-sync-event.test.ts:77-130`). Removing the old per-event `scope` predicate is therefore not itself a break: the project id in the outer event envelope now performs isolation before the process reducer (`packages/tui/src/context/sync.tsx:399-478`).
- Reactive TUI config survived the package move: the root installs `KiloTuiConfig.Provider` around all standalone consumers (`packages/tui/src/app.tsx:293-335`), `global.config.updated` refetches the server's effective TUI config (`packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config-hot-reload.ts:21-48`), and app/theme/keymap consumers read the same underlying `@tui/config` context.
- Terminal presence and title chains are still called from the extracted app (`packages/tui/src/app.tsx:452-475`): route state is sent through the SDK as viewer attached/visible state, reconnects resend it, and session/status data drives Kilo's terminal title in `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx:75-146,156-205`.
- Dedicated renderers for `background_process`, `interactive_terminal`, and `semantic_search` were restored in `packages/tui/src/routes/session/index.tsx`; the display-name registry is pinned by `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx`.

## Commands and limitations

Commands used included:

```text
git status --short --branch
git rev-parse HEAD
git diff --stat c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff --name-status -M -C c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff -Gkilocode_change --name-status -M -C c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD -- packages/opencode packages/tui packages/sdk packages/server
git grep -n kilocode_change c49560af0f94459015d3fa4e1efa23ad9b291955 -- <moved/deleted paths>
git grep -n KILO_EXPERIMENTAL_SESSION_SWITCHER c49560af0f94459015d3fa4e1efa23ad9b291955 -- packages/core packages/opencode
bun run script/check-opencode-annotations.ts --base c49560af0f94459015d3fa4e1efa23ad9b291955
```

Focused Bun tests were attempted in both `packages/opencode` and `packages/tui`, but neither suite started because the installed dependency set lacks the configured preload `@opentui/solid/preload`. The annotation command reported `Skipping shared upstream annotation check — upstream merge detected.` No full typecheck or broad test suite was run because the audit is source-only and commands are limited to two minutes. Interactive terminal behavior, anonymous Kilo provider onboarding, multi-hunk rendering, and the two deleted experimental features therefore require human runtime verification.

Pre-existing untracked reports were not read, modified, deleted, staged, or cleaned.
