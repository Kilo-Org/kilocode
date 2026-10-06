# Roadmap: Approve for Me

Rules for every PR:

- One concern per PR. Aim for under 500 changed lines of non-test code.
- Everything is behind the hidden flag until PR 11 (PR 3 sits behind the existing sandbox flag).
- A PR that changes the design edits `plans/approve-for-me/` in the same PR.
- Each PR passes: package `typecheck`, `lint`, focused tests, and the guards that apply
  (`check-opencode-annotations`, `knip` for `kilo-vscode`, i18n key test, SDK regeneration, `check-md-table-padding`).
- Each PR adds a changeset only if a user can see the change.
- Keep a status table here up to date (section 4).

## 1. PR list

### PR 0. This plan

Docs only. Merge the folder `plans/approve-for-me/`.
Accepted when the team agrees on the open questions in `README.md` section 5, or marks them "decide in PR n".

### PR 1. Entry point (#14636, open)

Hidden composer menu (Ask every time, Approve for Me, Approve all), exclusion with Auto-Approve, settings, docs.
No behavior change. Follow-up inside the PR: none planned.

### PR 2. Mode model: per-session state, flag, trust scope, selector

Goal: the server knows the mode, and the selector matches the team decision. The reviewer does not exist yet.

- Config: `approve_for_me` block in `packages/core/src/v1/config/config.ts` with `default_mode` (`approve-for-me | sandboxed | auto`), `stage` (`off | review | on`),
  `model?`, `timeout_ms?`, marked `kilocode_change`.
- Scope function in `P/kilocode/approve-for-me/config.ts`, applied next to `SandboxConfig.scope` (`P/config/config.ts:656-658`):
  project config cannot set any of these keys.
- Env flag `KILO_EXPERIMENTAL_APPROVE_FOR_ME` in `P/effect/runtime-flags.ts`.
- Session mode stored with the session, with an API to read and set it. The mode drives the sandbox state for the session.
  Approve for me and Auto-approve exclude each other. Until the reviewer ships, Approve for me behaves like Sandboxed.
- Platform rule from `design.md` 0.1 (decide first).
- VS Code: the menu becomes Approve for me / Sandboxed / Auto-approve, and the Sandbox button is hidden under the flag.
  TUI: `/approve-for-me` next to `/auto-approve`.
- Regenerate the SDK. Mirror the key in `Kilo-Org/cloud` (`extras.ts`) in a linked PR.
- Tests: scope function, exclusion, mode-to-sandbox mapping, unsupported platform, flag off leaves today's behavior unchanged.

Done when: choosing a mode in VS Code or the TUI sets the session mode and the sandbox state, and nothing else changes.

### PR 3. Sandbox escalation becomes an ask

Goal: a sandboxed command that needs more can ask the user, instead of being denied. Useful on its own.

- Sandboxed mode: `sandbox_escalation` requests reach the user with what the sandbox denied (host, path, Git verb).
- Update the clients that reject or skip these requests (`P/cli/cmd/run.ts:950-953`, VS Code `toggle-auto-approve.ts:78,93`, ACP, TUI) so each does the right thing per mode.
- Keep `interactive` for human replies (`P/permission/index.ts:295-304`).
- Telemetry: escalation count per class (this feeds the default-on decision).
- Tests: every client path; headless stays rejected.

Done when: in Sandboxed mode a `git commit` escalation can be approved from the prompt in TUI and VS Code.

### PR 4. Review skeleton in shadow mode (tiers 0 and 1)

Goal: the hook exists and records verdicts without changing outcomes.

- `P/kilocode/approve-for-me/` with the pure core (`types.ts`, `rules.ts`, `tier0.ts`, `tier1.ts`).
- Hook in `KiloSessionPrompt.askPermission` (`P/kilocode/session/prompt.ts:354-377`).
- Spike: confirm the once-scoped allow keeps deny and hard-veto precedence, and add the small marked change for `forceAsk` (`design.md` 1.2 and 2.5.4). Record the result in the PR.
- `metadata.review` written to the tool part. Telemetry event with tier, rule, stage.
- In `review` stage: compute, record, and return `pass` to the caller always.
- Tests: tool coverage table (every permission key has a test row; unknown key is tier 0), tier 0 set, deny precedence, headless.

Done when: with `review` on, every permission request has a recorded verdict, and user-visible behavior is unchanged.

### PR 5. Deterministic bash classifier (tier 2)

Goal: decide shell calls from facts.

- Facts extraction from the tree-sitter parse (`P/tool/shell.ts:369-452`), reusing `shell-pattern.ts`, `arity.ts`, `sandbox/git.ts`.
- Path facts: `realpath`, workspace containment, class, git tracked and dirty (no shell strings; use `git` with argv arrays).
- Rule table from `design.md` 2.3 with stable codes. Escalation classes included (`design.md` 2.5.3, item 1).
- Tests: table tests; spelling-equivalence and route-equivalence groups; the attack and benign corpus seed (`prior-art.md`).
- Still shadow only.

Coordination: agree with the author of #13893 / #14033 which pieces they contribute (`prior-art.md`). This PR is the most likely to overlap.

Done when: the corpus runs in CI; every attack in the seed corpus is `ask` or `block`; the benign seed set is mostly `allow`.

### PR 6. Show the verdict (labels only)

- VS Code `PermissionDock`: badge and localised one-line reason from the rule id. Escalation prompts show what the sandbox denied.
- VS Code transcript line for recorded verdicts (hidden unless `review` or `on`).
- TUI prompt and footer. JetBrains: render `meta.raw` review fields.
- i18n keys in all locales. Mockups in `mockups/` are the reference.

Done when: a flagged command shows a label in all three clients, with no change to who decides.

### PR 7. LLM reviewer (tier 3), shadow mode

- Reviewer module: input builder with byte budget, prompt, strict parser, deadline and retry, live re-check, per-session cache.
- Model resolution: global config or env only; reject OpenAI providers for this role; clear message when no model is available.
- Cost and latency recorded in `metadata.review`, telemetry, and the task cost.
- Tests with `TestLLMServer`: allow, keep_ask, garbage, empty, timeout, abort, oversized input (reviewer not called), injection strings in argv.

Done when: in `review` stage the reviewer runs on `reviewable` calls and escalations, and its verdict is logged next to the human decision.

### PR 8. Active mode

- `allow` verdicts approve the call through the once-scoped rule, escalations included under the guard rails in `design.md` 2.5.3.
  `ask` verdicts show the labelled prompt. `block` fails the call with the fixed message.
- Backstops: 3 consecutive blocks or 5 in the last 20 calls, and the escalation cap, stop auto-deciding for the session and notify the user.
- The settings toggle "Let Approve for me approve sandbox escalations" (default on).
- VS Code and `kilo run`: the client does not auto-reply in this mode. In `kilo run` without a human, `ask` is rejected as today.
- Human override of a block is recorded.
- Tests: end-to-end through `askPermission`; `skillShell` can never be auto-approved (property test over all request flags); `interactive` rules unchanged for human replies.

Done when: dogfood users run a normal session with fewer prompts and no unsafe auto-approval in the corpus.

### PR 9. Evaluation harness, escalation data, thresholds

- Hidden `kilo debug` command that runs the corpus against the current engine and reports false-allow, prompt reduction, latency and cost.
- CI runs the deterministic part. The model part runs on demand.
- Escalation report: rate per session, class mix, reviewer vs human agreement.
- Written graduation thresholds (for example: zero critical false-allows, at least N% fewer prompts on the benign set, p95 latency under X s,
  escalation rate low enough for sandbox default-on). Numbers set here with team input.
- Review point for escalation approval: narrow to deterministic-only if the data shows false allows.

### PR 10. Unified settings, migration and docs

- One settings page for permissions and sandbox: default mode, sandbox network/hosts/paths, reviewer model (non-OpenAI list), timeout, escalation toggle, "what is reviewed" table.
- Legacy import: map `yoloMode` and `yoloGatekeeperApiConfigId` (`legacy-gatekeeper.md` section 10). Never produce Auto-approve from a guarded setup.
- User docs in `packages/kilo-docs`, including limits: not a replacement for review, build and test commands run project code, data sent to the reviewer, behavior without a sandbox.

### PR 11. Graduation

- Remove the hidden flag, or flip its default, based on PR 9.
- Turn the sandbox on by default only if PR 9 thresholds hold. Provide good defaults for common hosts and paths.
- Remove `plans/approve-for-me/`.

## 2. Dependencies

```
0 -> 1 -> 2 -> 3
          2 -> 4 -> 5 -> 6
                4 -> 7 -> 8 -> 9 -> 10 -> 11
```

6 can start after 4. 7 needs 4. 8 needs 3, 5 and 7. 10 needs 8. PR 3 has value without the reviewer and can ship early.

## 3. Rollout

| Stage | Mode | Audience |
|---|---|---|
| A | Flag off | Everyone (PRs 1 to 3) |
| B | `review` (shadow) | Team dogfood. Verdicts logged, nothing changes |
| C | `on` | Team dogfood, with the backstops |
| D | `on` | Opt-in beta for users who enable the setting |
| E | Flag removed | After thresholds hold for a full release |

Rollback: set the mode to `off` (user), or flip the server flag (operator). `off` restores the plain prompt flow.
Keep the flag-off path identical to today. A test asserts it.

## 4. Status

| PR | Status |
|---|---|
| 0 Plan | This PR |
| 1 Entry point | Open: #14636 |
| 2 to 11 | Not started |

## 5. Work split with the community effort

PR #13893 and issue #14033 contain a large deterministic layer by another contributor, who offered to split it.
Past efforts stalled when two people worked on the same thing (#10248, #10267, #11619).
Before PR 5: post the plan link on #14033, propose the split, and agree owners per PR. See `prior-art.md`.
