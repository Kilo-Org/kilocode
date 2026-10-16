# Enable Kilo Swarm (shared agent board) by default

Goal: Kilo Swarm, the experimental shared agent board (tools `board_read` / `board_post`),
is enabled for every session by default. Users can opt out through a normal settings surface.
No renames of the config key, tool names, permissions, stored IDs, or migrations.

## Decisions

- D1. Default state: enabled. The board is active when the config key is absent and no env flag is set.
- D2. Opt-out is explicit. The board is disabled only when:
  - `experimental.shared_agent_board` in config is exactly `false`, or
  - `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD` is set to a falsy boolean (`false`, `no`, `off`, `0`, `n`).
  Either explicit disable wins. There is no "env true beats config false" rule anymore.
- D3. `KILO_EXPERIMENTAL` (umbrella) no longer toggles this feature. It stays enabled regardless.
  `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD=true` remains accepted but is redundant.
- D4. Implementation follows the existing `experimentalBackgroundSubagents` precedent:
  `RuntimeFlags.experimentalSharedAgentBoard` is a boolean that defaults to `true` with an
  opt-out kill switch. `BoardEnabled.resolve` becomes an opt-out predicate over `config` and `flag`.
- D5. `BoardEnabled.resolve` keeps its `{ config?: boolean; flag?: boolean }` signature and its
  call sites. Only the returned logic changes.
- D6. Config schema is unchanged. `experimental.shared_agent_board` still decodes to `undefined`
  when absent, so `packages/core` config tests stay valid.
- D7. VS Code UI treats an absent config key as enabled:
  the Experimental toggle starts checked and the Board header gate allows the board.
- D8. Non-goals: no new settings key, no changes to board tool behavior, permissions, storage,
  migrations, or the SDK schema. No change to JetBrains beyond inheriting the CLI default.
- D9. Two verification-only test files (`test/kilocode/tool-registry-indexing.test.ts`,
  `test/kilocode/board-context.test.ts`) had expectations that encoded the old opt-in default.
  Their ownership was extended to unit A for pure expectation updates only; no source logic changed.
- D10. D2 note: "falsy boolean" means `Config.boolean` falsy values. An empty string is a parse
  failure, matching pre-existing `Config.boolean` behavior.
- D11. (supersedes D7's placement) The user-facing opt-out toggle moves from the **Experimental**
  tab to the **Agent Behaviour** tab, agents subtab, so it reads as a normal setting. The config
  key `experimental.shared_agent_board` and the existing i18n keys stay unchanged. No CLI change.
- D12. The `settings--agent-behaviour-agents` visual-regression baseline changes. The
  visual-regression workflow auto-generates and commits baselines on internal PRs, so no local
  baseline edit is required.

## Tasks

### A. CLI default-on semantics (owner: packages/opencode + changeset) - DONE
Owns: `src/effect/runtime-flags.ts`, `src/kilocode/board/enabled.ts`, board-enabled/board-tools/
runtime-flags tests, `.changeset/swarm-enabled-by-default.md`.

### B. VS Code defaults and docs (owner: packages/kilo-vscode + packages/kilo-docs) - DONE
Owns: `ExperimentalTab.tsx`, `SwarmBoard.tsx`, doc pages, changeset wording.

### C. Verification of A and B - DONE

### D. Move the opt-out toggle to Agent Behaviour (owner: packages/kilo-vscode + docs)
Owns:
- `packages/kilo-vscode/webview-ui/src/components/settings/ExperimentalTab.tsx`
- `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx`
- `packages/kilo-docs/pages/getting-started/settings/index.md`
- `packages/kilo-docs/pages/automate/tools/index.md`
- `packages/kilo-docs/pages/automate/agent-manager.md`
- `.changeset/swarm-enabled-by-default.md`
Provides: the relocated setting; needs the existing config key only.

### E. Verification of D
Owns: no source files.

## Acceptance criteria (unit D)

1. The Kilo Swarm switch no longer renders in the Experimental tab, and renders in the
   Agent Behaviour tab's agents subtab.
2. The switch keeps the `experimental.shared_agent_board` key, defaults to checked when the key
   is absent, and persists `false` to global config when switched off.
3. Docs say the opt-out lives in **Settings > Agent Behaviour** and no longer say Experimental.
4. The changeset describes the default-on behavior and the Agent Behaviour opt-out.
5. VS Code typecheck and focused unit tests pass. No other file changes.

## Findings

### A. CLI default-on semantics
Done. `BoardEnabled.resolve` is opt-out (`config === false` then `flag === false`, else `true`).
`RuntimeFlags.experimentalSharedAgentBoard` is `Config.boolean(...).pipe(Config.withDefault(true))`
behind kilocode_change markers. Tests green: board-enabled 9/9, board-tools 8/8, runtime-flags
39/39, tool-registry-indexing 16/16, board-context 12/12; typecheck clean. Fail-without-fix:
reverting both source edits made board-enabled fail 5/9 and board-tools fail 1/8.

### B. VS Code defaults and docs
Done. `ExperimentalTab.tsx:186` and `SwarmBoard.tsx:59` treat an absent key as enabled. Docs
updated. VS Code typecheck exit 0; full unit suite 5658 pass / 0 fail. No other client-side gate.

### C. Verification of A and B
Independent verifier green on all criteria, including a safe fail-without-fix revert. Residual
notes: `agent/index.ts` cacheKey stores the raw config value (harmless); empty-string env is a
parse failure.

### D. Move the toggle to Agent Behaviour
Done. The Kilo Swarm `SettingsRow` was removed from `ExperimentalTab.tsx` and inserted in
`AgentBehaviourTab.tsx` between the "Default agent" Select and "Push fixes" Switch (Push fixes
keeps `last`). It uses the existing `experimental.shared_agent_board` key, defaults checked
(`?? true`), and writes through `updateConfig`. The three docs pages and the changeset now point
at **Settings > Agent Behaviour**. No CLI, config-key, i18n, or permission change.

### E. Verification of D
Verified by main on the combined diff: the switch renders only in `AgentBehaviourTab.tsx:313-323`
(ExperimentalTab has zero references); `bun run typecheck` clean; `bun run lint` exit 0;
`bun test tests/unit/config-utils.test.ts tests/unit/config-scope.test.ts` 38 pass / 0 fail;
prettier clean on both TSX files. `settings--agent-behaviour-agents` baseline changes; the
visual-regression workflow regenerates and commits it on internal PRs.

VS Code self-test (`vscode-self-test`, isolated dev instance, headless, disposable profile):
- Fresh launch, Settings > Agent Behaviour (agents subtab): the Kilo Swarm row is present and its
  switch is `aria-checked="true"` by default.
- Settings > Experimental: zero Kilo Swarm rows.
- Toggling the switch off and clicking Save wrote `"shared_agent_board": false` into the isolated
  global `kilo.jsonc`, and the save bar cleared.
- After a full VS Code restart with the same profile, the switch rendered `aria-checked="false"`,
  confirming the opt-out persists.
- Isolated instance cleaned up and the profile removed. The extension build regenerated
  `packages/sdk/js/src/v2/gen/sdk.gen.ts` (an unrelated doc-comment drift); it was reverted.

## Review log
- A (CLI default-on): `ship`.
- B (VS Code defaults + docs): `ship`.
- C (independent verification): `ship`.
- Integration follow-up (main): removed the stale word "optional" from
  `customize/custom-subagents.md`; formatted `runtime-flags.test.ts` with prettier.
- D (move toggle to Agent Behaviour): `ship`. Diff reviewed; typecheck/lint/tests green; VS Code
  self-test confirmed default-on rendering, absence from Experimental, the persisted `false`, and
  persistence across a restart.
