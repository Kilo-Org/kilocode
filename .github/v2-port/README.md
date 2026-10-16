# v2-port tracker

Files a `[v2-port]` tracking issue for every merged PR that carries a Kilo-specific change to
`packages/opencode/`, so the behavior can be re-implemented or verified in the opencode v2 rewrite. It is
the automated form of the `pr-track-v1` skill.

## What triggers a run

`.github/workflows/v2-port-tracker.yml` runs after a PR merges into a base branch, when the PR touches
`packages/opencode/**`. `gate.mjs` then decides whether the PR actually qualifies:

| Outcome | Condition |
|---|---|
| Skipped | Not merged, bot author, `no-v2-port` label, or already carries `core-v1-changes-port` |
| Qualifies | Diff touches a `packages/opencode/` path with `kilocode` in a segment or filename, or adds a `kilocode_change` marker line in a `packages/opencode/` file |
| Skipped | Anything else — pure upstream merges, formatting, dependency bumps, unmarked shared-code edits |

The gate is deterministic and costs nothing, so most merged PRs never reach the model.

## Where the code lives

| File | Role |
|---|---|
| `gate.mjs` | Qualification + writes `v2-port-out/pr.json` and `pr.diff`. `gate.test.mjs` covers it. |
| `prompt.md` | The agent's instructions. Loads the vendored `.kilo/skills/pr-track-v1/SKILL.md` and applies the CI-only deltas. |
| `issue.mjs` | Draft validation, dedup, label ensure, issue create, assignee resolution, PR back-link. `issue.test.mjs` covers it. |

The skill itself lives at `.kilo/skills/pr-track-v1/SKILL.md` so the interactive `/pr-track-v1` command and
CI share one source of truth. CI-only differences (author assignment, no `gh`, no interaction) live in
`prompt.md`, never in the skill.

## Security posture

The agent is steered by untrusted PR text — titles, bodies, diffs, and review comments from any
contributor. So:

- The workflow runs on `pull_request_target` and checks out the **base branch tip**, never the PR head ref.
  No contributor code is ever executed, and checkout uses `persist-credentials: false` so the workflow
  token is not written into the agent's workspace.
- The agent step receives **no `GH_TOKEN`**. `KILO_CONFIG_CONTENT` denies `bash`, `webfetch`, `websearch`,
  `task`, `external_directory`, and the memory/recall tools, and scopes writes to `v2-port-out/**`. The PR
  metadata is pre-fetched and attached, so the agent needs no network and no shell.
- Permissions are explicit **denies**, not `--auto`. An inherited `ask` default is auto-rejected headlessly,
  which aborts the whole run (`packages/opencode/src/cli/cmd/run.ts:1032-1039`); an explicit `deny` returns a
  tool error the agent can recover from. That is why the deny list is spelled out rather than relying on
  defaults, and why the agent never gets `--auto`: a missing allow fails loudly instead of silently
  widening access.
- Every GitHub mutation happens in `issue.mjs` afterwards, with the job token.
- Runs triggered by a `pull_request` (only when someone edits this directory or the workflow) execute in a
  read-only, secretless `selftest` job that never calls an LLM.

Worst case for a crafted PR is a misleading issue body, which a human reviews. That is the intended
trade-off, and it is why the agent never gets `--auto` — a missing allow entry fails loudly instead of
silently widening access.

## Setup

Both secrets already exist for `docs-sync`:

- `KILO_API_KEY` — Kilo Gateway key.
- `KILO_ORG_ID` — required; without it the gateway bills the key owner's personal balance.

Optional repository variables:

| Variable | Default | Purpose |
|---|---|---|
| `V2_PORT_MODEL` | `kilo/anthropic/claude-sonnet-4.6` | Model that writes the issue. |
| `V2_PORT_VARIANT` | `high` | Reasoning effort. |

## Operating it

Dry run against a merged PR, no issue created:

```bash
gh workflow run v2-port-tracker.yml -f pr_number=<N> -f dry_run=true
```

Real run:

```bash
gh workflow run v2-port-tracker.yml -f pr_number=<N>
```

Re-running is safe. An existing tracking issue is detected by the `<!-- v2-port:pr-<N> -->` marker in its
body, and the PR back-link is upserted rather than duplicated.

## Conventions

- Add `no-v2-port` to a PR to stop it being tracked. Use it for Kilo-specific changes that intentionally do
  not need a v2 counterpart.
- Add `core-v1-changes-port` to a PR that is already tracked by hand; the gate then skips it.
- Every filed issue carries `core-v1-changes-port` and is assigned to the PR author. If the author has no
  repo access (external contributors, bots), the issue is created **unassigned** and the run logs a
  `::warning::`.

## Failure handling

| Situation | Result |
|---|---|
| Gate skip, or the agent writes `skip.txt` | Green run with a summary line |
| Agent fails both attempts | Red run; `workflow_dispatch` replays it |
| Draft fails validation (missing section, unresolved placeholder, bad title) | Red run, **nothing created** |
| API error mid-way | Red run; re-run dedups and upserts |

Artifacts (`pr.json`, `pr.diff`, the generated draft, and `draft-log-*.txt`) are uploaded on every run
for 14 days.

## Tests

```bash
node .github/v2-port/gate.test.mjs
node .github/v2-port/issue.test.mjs
```

`issue.test.mjs` drives the real `issue.mjs` against a local stub of the GitHub API via the
`DOCS_SYNC_API_BASE` hook, so dedup, assignee resolution, and comment idempotency are exercised as real
code. The same two commands run in the workflow's `selftest` job.
