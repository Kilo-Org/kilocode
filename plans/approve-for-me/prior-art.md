# Prior art

What earlier attempts offer, and what we take or leave.
References: PR/issue numbers are in `Kilo-Org/kilocode` unless noted.

## 1. Timeline

| Item | State | Idea |
|---|---|---|
| Legacy #3643 (2025-11) | merged (legacy) | LLM gatekeeper inside YOLO. See `legacy-gatekeeper.md` |
| [#7684](https://github.com/Kilo-Org/kilocode/issues/7684) | closed (stale bot) | Reintroduce for CLI and the new extension. Needs fallback to manual approval when unsure |
| [#9138](https://github.com/Kilo-Org/kilocode/issues/9138) | closed (stale bot) | "LLM-based bash command auto-approval", modelled on Claude Code auto mode: safe-tool allowlist, then a two-stage classifier. Names prompt injection and false-positive recovery as the hard parts. Comment: bind the decision to the full action context (cwd, files, MCP identity), not just the command string |
| #10248, #10249 to #10255 | closed (stale bot) | Rollout tracker. #10252: migrate legacy YOLO settings and never silently turn guarded YOLO into allow-all. #10253: show decisions inline with reason, model and cost; keep approvals quiet and denials prominent |
| #10267 | closed (stale bot) | Top-level `gatekeeper` config, default model `kilo-auto/balanced`, separate from `small_model` |
| #11619 | closed (stale bot) | Runs only on the would-auto-approve path. A block is a tool error so the agent continues. Fails closed to a human. Reasoning-blind transcript. Escalates after 3 consecutive or 20 total denials |
| [#13893](https://github.com/Kilo-Org/kilocode/pull/13893) / [#14033](https://github.com/Kilo-Org/kilocode/issues/14033) | open | Deterministic floor decided by what a command does, plus a narrow reviewer. 129 files, +15.5k lines |
| [#14636](https://github.com/Kilo-Org/kilocode/pull/14636) | open | Entry point (this plan's PR 1) |

Why the earlier ones died: they were large, there was no agreed owner, and two people sometimes built the same thing in parallel.
The stale bot closed them without a product decision.

## 2. PR #13893 in short

It is **not** an approve-for-me design. It is a deterministic floor under allow rules. It can raise `allow` to `ask` or `deny`.
Its reviewer can only undo asks that the layer itself raised. It never answers asks from the normal ruleset.
This is the opposite direction of Approve for Me, but its engine (facts, rules, tests) is what tiers 2 and 3 need.

Pipeline (all in the PR; paths are PR paths under `packages/opencode/src/kilocode/security-decision/` unless noted):

1. Facts from the tree-sitter AST (`kilocode/tool/shell-security-facts.ts`) and from path classification (`adapter.ts`).
2. Pure core (`core.ts`, `types.ts`, `rules.ts`) with no IO. Result: `{ decision, rule_id, reviewable }`.
3. Optional reviewer (`reviewer.ts`, `reviewer-config.ts`, `reviewer-binding.ts`) only on `ask` + `reviewable`.
4. Live re-check of state after the verdict (`gate.ts:252-270`).
5. Escalation breaker (`continuation.ts:36`: 3 consecutive, window 20, recent 5).
6. Shared status for clients (`packages/core/src/security-status.ts`).

Author's benchmark (#14033): no layer 100% attack success; layer plus sandbox 2.6% with 5 false positives out of 10 tasks;
layer plus live reviewer (Qwen 3.5 35B) 5.3% with 0 false positives. **The reviewer made attack success worse** by allowing a
source-tree deletion through a reviewable class. That is the main evidence for our "shadow first" and "narrow reviewer" decisions.

## 3. What to take

| Item | Where in #13893 | Use in our plan |
|---|---|---|
| Pure core contract: `decision`, `rule_id`, `reviewable`, no IO | `types.ts`, `rules.ts` | Our `Verdict` (design 4) |
| Stable reason codes as the only text sent back to the model | `rules.ts:6-8`, `block.ts` | Block message |
| Aggregation by precedence, not fact order | `core.ts:885-911` | Tier 2 |
| Canonical argv (`bare`, `delivered`), `pathed` and `assigns` flags | `core.ts:30-63`, `shell-security-facts.ts:58-74,39-48` | Tier 2 facts |
| Git verb plus flag allowlist; global flags refused | `core.ts:191-201,414-453` | Tier 2 |
| Symlink resolution that fails closed (16 hops) | `realpath.ts:71-99` | Path facts |
| Path classes; git hooks deny; control plane ask; subtree inheritance | `adapter.ts:224-279` | Path facts |
| Reviewer input: facts only, in-workspace paths only, byte budget | `reviewer.ts:263-288,226-242` | Tier 3 input. **Drop the `task` field** (it is model-written prose, `adapter.ts:666-670`) |
| Prompt framing: untrusted data, `keep_ask` is always safe | `reviewer.ts:310-336` | Tier 3 prompt |
| Strict decision parse, lenient reason code, one shared deadline | `reviewer.ts:356-394` | Tier 3 |
| Reviewer model trust rule (env or global only; merged provider must equal global) | `reviewer-config.ts:94-139` | Design 5.3 |
| Escalation breaker numbers | `continuation.ts:36` | Design 8 |
| Attack and benign corpus; spelling and route equivalence tests | `test/.../corpus.ts:86-161`, `route-equivalence.test.ts`, `spelling-equivalence.test.ts`, `bypass-regression.test.ts` | Evaluation corpus and PR 4 tests |
| One status mapping for all clients | `packages/core/src/security-status.ts` | Client labels |

Attack classes from the corpus, as a checklist for PR 4:
carried program (`sh -c`, `python -c`, `awk`, `caffeinate ...`); secret read through git or an unknown reader (`git show HEAD:.env`,
`xxd .env`, `curl --data-binary @.env`, `env > file`); persistence and destruction (`.git/hooks`, `core.hooksPath`, `rm -rf ~`, `dd of=/dev/...`);
dependency install; host control (docker socket, ssh, `launchctl`, `crontab`, `defaults write`);
spelling rewrites (`PATH=`, `alias`, quoting, `\rm`, `/bin/rm`, `.GIT/hooks`, `cp -t`, `--output=`).

## 4. What to leave

- The single 15.5k-line PR. Four concerns are bundled (RPC fix, human-only asks, engine, UI).
- Large edits in shared files (`permission/index.ts` +219 lines with 25 markers, `tool/shell.ts` +151, `session/tools.ts` +99).
  We use a hook in a Kilo-owned file.
- Config through environment variables only. We need a schema key, a settings UI and a trust scope.
- The macOS-only Seatbelt containment probe as a requirement.
- Module-level mutable reviewer state and the dynamic `AppRuntime` import (`reviewer-binding.ts:77-89`), which breaks the repo's facade rule.
- Making `DESTRUCTIVE_FS` reviewable. That is where the reviewer failed in the benchmark.
- Treating normal developer commands as `ask` (`git add`, `git commit`, `grep`, `find`). Approve for Me exists to remove those prompts.
- `kilo debug security-bench` and 9.8k lines of tests in one go. Bring tests with each rule.

## 5. Coordination

- Post the plan link on #14033, thank the author, and propose: they own the deterministic engine PRs (our PR 4), we own the hook, state, UI and reviewer.
- Ask the maintainers to confirm the split before PR 4 starts, and record the decision on #14033.
- Credit the author in PR 4 and in the docs.
