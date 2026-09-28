# Security automation

Workflows that automate dependency remediation and give the team Slack visibility into security findings, without depending on the private `Kilo-Org/cloud` Security Agent stack.

| File | Trigger | Manual run |
|---|---|---|
| `dependabot-auto-merge.yml` | `schedule`: every 30 minutes, plus `workflow_dispatch` | Actions tab → "Dependabot auto-merge" → Run workflow, or `gh workflow run dependabot-auto-merge.yml` |
| `security-findings-notify.yml` | `schedule`: every 6 hours, plus `workflow_dispatch` | Actions tab → "Security findings notify" → Run workflow, or `gh workflow run security-findings-notify.yml` |
| `stale-bot-pr-notify.yml` | `schedule`: daily at 13:00 UTC, plus `workflow_dispatch` | Actions tab → "Stale bot PR notify" → Run workflow, or `gh workflow run stale-bot-pr-notify.yml` |
| `../dependabot.yml` | Not a workflow — read directly by GitHub's Dependabot service | No manual run; check **Insights → Dependency graph → Dependabot** |

## Setup

- Add repo secret `SECURITY_ALERTS_SLACK_WEBHOOK` (a Slack incoming webhook URL) — required by `security-findings-notify.yml` and `stale-bot-pr-notify.yml`.
- Optional repo variables to override defaults: `SECURITY_SLA_CRITICAL_DAYS` (15), `SECURITY_SLA_HIGH_DAYS` (30), `STALE_BOT_PR_DAYS` (3).

## Fork-safety notes

kilocode is a fork of opencode sharing one `bun.lock` with upstream-owned `@opencode-ai/*` packages. Two things exist specifically to avoid friction with upstream syncs:

- `dependabot-auto-merge.yml` only auto-merges a PR if every changed file (besides the shared `bun.lock`) lives under a `kilo`-named path. Anything touching shared/upstream code is left for a human.
- `dependabot.yml` deliberately does **not** cover `packages/opencode/Dockerfile` or `.github/workflows/**`: both are shared/upstream paths that the auto-merge guard above would never approve anyway, and `.github/workflows/**` changes routinely fail this repo's `kilocode_change` annotation check unless they land inside an existing marker block. Those paths are covered by `security-findings-notify.yml` instead, which only reads GitHub's alerts, it never proposes a PR.
