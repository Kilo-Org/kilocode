# Roadmap: Approve for Me

Rules for every PR:

- One concern per PR. Aim for under 500 changed lines of non-test code.
- Everything is behind the hidden flag until PR 10.
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

### PR 2. Server mode, flag and trust scope

Goal: the server knows the mode. Still no behavior change.

- Config: `approve_for_me` block (`mode: off | review | on`, `model?`, `timeout_ms?`) in `packages/core/src/v1/config/config.ts`, marked `kilocode_change`.
- Scope function in `P/kilocode/approve-for-me/config.ts`, applied next to `SandboxConfig.scope` (`P/config/config.ts:656-658`):
  project config cannot set any of these keys.
- Env flag `KILO_EXPERIMENTAL_APPROVE_FOR_ME` in `P/effect/runtime-flags.ts`.
- `ApproveForMe.State` service and an API `permission.approveForMe { mode }`. Rejects `on` while allow-everything is active.
- Regenerate the SDK. Mirror the key in `Kilo-Org/cloud` (`extras.ts`) in a linked PR.
- VS Code: the mode menu sends the mode to the server and reads it back. TUI: `/approve-for-me` command.
- Tests: scope function (project cannot set), exclusion, API round trip, flag off means API refuses.

Done when: toggling in VS Code or the TUI changes the server state, and nothing else changes.

### PR 3. Review skeleton in shadow mode (tiers 0 and 1)

Goal: the hook exists and records verdicts without changing outcomes.

- `P/kilocode/approve-for-me/` with the pure core (`types.ts`, `rules.ts`, `tier0.ts`, `tier1.ts`).
- Hook in `KiloSessionPrompt.askPermission` (`P/kilocode/session/prompt.ts:354-377`).
- Spike: confirm the once-scoped allow keeps deny and hard-veto precedence (`design.md` 1.2). Record the result in the PR.
- `metadata.review` written to the tool part. Telemetry event with tier, rule, mode.
- In `review` mode: compute, record, and return `pass` to the caller always.
- Tests: tool coverage table (every permission key has a test row; unknown key is tier 0), tier 0 set, deny precedence, headless.

Done when: with `review` on, every permission request in a real session has a recorded verdict, and a diff of user-visible behavior is empty.

### PR 4. Deterministic bash classifier (tier 2)

Goal: decide shell calls from facts.

- Facts extraction from the tree-sitter parse (`P/tool/shell.ts:369-452`), reusing `shell-pattern.ts`, `arity.ts`, `sandbox/git.ts`.
- Path facts: `realpath`, workspace containment, class, git tracked and dirty (no shell strings; use `git` with argv arrays).
- Rule table from `design.md` 2.3 with stable codes.
- Tests: table tests; spelling-equivalence and route-equivalence groups; the attack and benign corpus seed (`prior-art.md`).
- Still shadow only.

Coordination: agree with the author of #13893 / #14033 which pieces they will contribute (`prior-art.md`). This is the PR most likely to overlap.

Done when: corpus runs in CI; every attack in the seed corpus is `ask` or `block`; benign seed set is mostly `allow`.

### PR 5. Show the verdict (labels only)

Goal: users see what the reviewer thinks, even in shadow mode.

- VS Code `PermissionDock`: badge and localised one-line reason from the rule id.
- VS Code transcript line for recorded verdicts (hidden unless `review` or `on`).
- TUI prompt and footer. JetBrains: render `meta.raw` review fields.
- i18n keys in all locales. Mockups in `mockups/` are the reference.

Done when: a flagged command shows a label in all three clients, with no change to who decides.

### PR 6. LLM reviewer (tier 3), shadow mode

Goal: measure the model before it can allow anything.

- Reviewer module: input builder with byte budget, prompt, strict parser, deadline and retry, live re-check, per-session cache.
- Model resolution: global config or env only; reject OpenAI providers for this role; clear message when no model is available.
- Cost and latency recorded in `metadata.review` and telemetry.
- Tests with `TestLLMServer`: allow, keep_ask, garbage, empty, timeout, abort, oversized input (reviewer not called), injection strings in argv.

Done when: in `review` mode the reviewer runs on `reviewable` calls and its verdict is logged next to the human decision.

### PR 7. Active mode

Goal: `on` mode changes outcomes.

- `allow` verdicts approve the call through the once-scoped rule. `ask` verdicts show the labelled prompt. `block` fails the call with the fixed message.
- Escalation backstop: 3 consecutive blocks or 5 in the last 20 calls stops auto-deciding for the session and notifies the user.
- VS Code and `kilo run`: the client does not auto-reply in this mode. In `kilo run` without a human, `ask` is rejected as today.
- Human override of a block is recorded.
- Tests: end-to-end through `askPermission`; the tier 0 set can never be auto-approved (property test over all request flags); `interactive` rules unchanged.

Done when: dogfood users can run a normal coding session with fewer prompts and no unsafe auto-approval in the corpus.

### PR 8. Evaluation harness and thresholds

- `kilo debug` command (hidden) that runs the corpus against the current engine and reports false-allow, prompt reduction, latency and cost.
- CI job runs the deterministic part. The model part runs on demand.
- Written graduation thresholds (for example: zero critical false-allows, at least N% fewer prompts on the benign set, p95 latency under X s). Numbers set here with team input.

### PR 9. Settings, migration and docs

- Settings page: mode, reviewer model picker (non-OpenAI list), timeout, "what is reviewed" table. No free-text prompt editing.
- Legacy import: map `yoloMode` and `yoloGatekeeperApiConfigId` (`legacy-gatekeeper.md` section 10). Never produce Approve all from a guarded setup.
- User docs in `packages/kilo-docs` (permissions page), including limits: not a sandbox, test and build commands run project code, data sent to the reviewer.

### PR 10. Graduation and unification

- Remove the hidden flag, or flip its default, based on PR 8 results.
- Decide the Sandbox relation: one selector with Sandbox as a layer, and sandbox escalation changing from deny to ask.
- Remove `plans/approve-for-me/`.

## 2. Dependencies

```
0 -> 1 -> 2 -> 3 -> 4 -> 5
                \-> 6 -> 7 -> 8 -> 9 -> 10
 5 can start after 3. 6 needs 3. 7 needs 4 and 6. 9 needs 7.
```

## 3. Rollout

| Stage | Mode | Audience |
|---|---|---|
| A | Flag off | Everyone (PRs 1 to 2) |
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
| 2 to 10 | Not started |

## 5. Work split with the community effort

PR #13893 and issue #14033 contain a large deterministic layer by another contributor, who offered to split it.
Past efforts stalled when two people worked on the same thing (#10248, #10267, #11619).
Before PR 4: post the plan link on #14033, propose the split, and agree owners per PR. See `prior-art.md`.
