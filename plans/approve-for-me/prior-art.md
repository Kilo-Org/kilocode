# Prior art

Earlier work on this feature, and what we take or leave. This file keeps ideas only. No code reuse is implied. If code from any earlier work is reused, check its license and credit the author.

## 1. Earlier approaches

| Approach | Idea |
|---|---|
| Legacy Gatekeeper (Kilo's own, 2025-11) | An LLM safety check inside YOLO mode. See `legacy-gatekeeper.md` |
| Reviewer on the auto-approve path | Runs only on what would be approved anyway. A block is a tool error, so the agent continues. Fails closed to a human. The reviewer sees no transcript. After repeated denials it hands control to the user |
| Deterministic floor | Decides by what a command does, not how it is spelled, using a parsed command and path facts. A narrow reviewer can only undo an ask that the floor raised |
| Modelled on other tools' auto modes | A safe-tool allowlist first, then a classifier. Names prompt injection and false positives as the hard parts. Binds the decision to the full action context (folder, files, MCP identity), not only the command text |
| Migration and visibility ideas | Never turn a guarded legacy setup into allow-all. Show decisions inline with reason, model and cost. Keep approvals quiet and denials prominent |

Why earlier efforts stalled: they were large, and a large single change is hard to review and merge. This plan builds in small PRs behind one hidden flag.

## 2. Evidence for the design

A public benchmark of a deterministic layer reported the following, over ten tasks:

- With no layer, attack success was 100%.
- With the layer plus a sandbox, attack success was 2.6%, with 5 false positives.
- With the layer, the sandbox and a live reviewer model, attack success was 5.3%, with 0 false positives. **The reviewer made attacks succeed more** by allowing a source-tree deletion through a class it was allowed to judge.

This is the main evidence for the "shadow first", "narrow reviewer" and "deterministic-only first release" decisions.

## 3. What to take

| Idea | Use in our plan |
|---|---|
| A pure core: `decision`, `rule_id`, `reviewable`, no IO | The `Verdict` type (design 4) |
| Stable reason codes as the only text sent back to the model | Block message (design 5.5) |
| Aggregate by precedence, not by fact order | Tier 2 |
| Canonical argv, flags for "delivered by path" and "has assignments" | Tier 2 facts |
| Git verb plus flag allowlist, global flags refused | Tier 2 exact argv shapes (design 2.3) |
| Symlink resolution that fails closed, with a hop limit | Path facts and link-safe writes (design 2.14) |
| Path classes: hooks deny, control plane ask, subtree inheritance | Path facts (design 2.6) |
| Reviewer input: facts only, in-workspace paths only, byte budget | Tier 3 input (design 5.1). The model-written task text is dropped |
| Prompt framing: untrusted data, `keep_ask` is always safe | Tier 3 prompt (design 5.2) |
| Strict decision parse, lenient reason code, one shared deadline | Tier 3 |
| Reviewer model trust rule: environment or global config only, the merged provider must equal the global one | Reviewer resolver (design 5.3) |
| Escalate to the user after 3 consecutive blocks, or 5 in the last 20 calls | Backstop (design 8) |
| An attack and benign corpus, with spelling and route equivalence tests | Evaluation corpus and PR 5 tests |
| One status mapping for all clients | Client labels (design 7) |

Attack classes for the corpus, as a checklist for PR 5:
carried program (`sh -c`, `python -c`, `awk`, `caffeinate ...`); secret read through git or an unknown reader (`git show HEAD:.env`,
`xxd .env`, `curl --data-binary @.env`, `env > file`); persistence and destruction (`.git/hooks`, `core.hooksPath`, `rm -rf ~`, `dd of=/dev/...`);
dependency install; host control (docker socket, ssh, `launchctl`, `crontab`, `defaults write`);
spelling rewrites (`PATH=`, `alias`, quoting, `\rm`, `/bin/rm`, `.GIT/hooks`, `cp -t`, `--output=`).

## 4. What to leave

- A single very large change. Four concerns were bundled (an RPC fix, human-only asks, the engine, the UI).
- Large edits in shared upstream files. We use a hook in a Kilo-owned file.
- Configuration through environment variables only. We need a schema key, a settings page and a trust scope.
- A macOS-only containment probe as a requirement.
- Module-level mutable reviewer state and a dynamic runtime import, which break the repository's facade rule.
- Letting the reviewer judge destructive file operations. That is where it failed in the benchmark.
- Treating normal developer commands as `ask` (`git add`, `git commit`, `grep`, `find`). Approve for Me exists to remove those prompts.
- A large debug benchmark command and a very large test suite in one go. Tests come with each rule.
