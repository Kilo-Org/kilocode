# Security automation

Workflows that automate dependency remediation and give the team Slack visibility into security findings, without depending on the private `Kilo-Org/cloud` Security Agent stack.

| File | Trigger | Manual run |
|---|---|---|
| `dependabot-auto-merge.yml` | `schedule`: hourly, plus `workflow_dispatch` | Actions tab → "Dependabot auto-merge" → Run workflow, or `gh workflow run dependabot-auto-merge.yml` |
| `security-findings-notify.yml` | `schedule`: every 6 hours, plus `workflow_dispatch` | Actions tab → "Security findings notify" → Run workflow, or `gh workflow run security-findings-notify.yml` |
| `outdated-kilo-deps.yml` | `schedule`: monthly on the 1st at 09:23 UTC, plus `workflow_dispatch` | Actions tab → "Outdated Kilo dependencies" → Run workflow, or `gh workflow run outdated-kilo-deps.yml` |
| `stale-bot-pr-notify.yml` | `schedule`: daily at 13:00 UTC, plus `workflow_dispatch` | Actions tab → "Stale bot PR notify" → Run workflow, or `gh workflow run stale-bot-pr-notify.yml` |
| `../dependabot.yml` | Not a workflow — read directly by GitHub's Dependabot service | No manual run; check **Insights → Dependency graph → Dependabot** |

## Setup

- Add repo secret `SECURITY_ALERTS_SLACK_WEBHOOK` (a Slack incoming webhook URL) — required by `security-findings-notify.yml`, `stale-bot-pr-notify.yml` and `outdated-kilo-deps.yml`.
- Optional repo variables to override defaults: `SECURITY_SLA_CRITICAL_DAYS` (15), `SECURITY_SLA_HIGH_DAYS` (30), `STALE_BOT_PR_DAYS` (3).

## How it works

### PRs are opened by Dependabot's own service, not by any workflow here

`dependabot.yml` is not a workflow — it's a config file that GitHub's Dependabot backend reads directly. None of the workflow files in this directory ever open a PR; they only act on PRs or alerts that already exist, or report on dependencies.

Dependabot re-scans on the `schedule: interval` set per ecosystem block, and once immediately whenever `dependabot.yml` itself changes on the default branch. Per ecosystem (`npm` for kilo-docs, `gradle` for kilo-jetbrains), it checks each dependency for updates, bundles minor and patch bumps into `groups: *-minor-patch` PRs (related packages share a group, so they move together), and ignores every major bump. Majors are bumped by hand. The `bun` block has `open-pull-requests-limit: 0`, so it opens no version-update PRs, only security-alert PRs, which a `security-updates` group bundles into one PR. These are normal PRs from that point on — required CI and branch protection apply like any other PR.

### The 4 workflows each poll independently on their own schedule

They don't call each other or trigger off PR creation. Each one wakes up on its own cron and reads whatever state currently exists on GitHub:

| Workflow | Wakes up | Reads | Does |
|---|---|---|---|
| `dependabot-auto-merge.yml` | Hourly | Open `app/dependabot` PRs with a grouped `*-minor-patch` title | Enables GitHub's native auto-merge flag if every changed file besides shared `bun.lock` is under a `kilo`-named path; otherwise leaves it and logs a warning. |
| `security-findings-notify.yml` | Every 6h | GitHub's Dependabot **Alerts** (the vulnerability list, separate from the PR list above) | Posts new/at-risk/breached critical & high alerts to Slack, independent of whether a fix PR exists. |
| `outdated-kilo-deps.yml` | Monthly, 1st at 09:23 UTC | `bun outdated` for `packages/kilo-*` (not kilo-docs; it has its own Dependabot block) | Posts the count of outdated major/minor/patch dependencies to Slack, with the major and minor ones listed. Fills the gap left by turning off the root `bun` version updates. |
| `stale-bot-pr-notify.yml` | Daily, 13:00 UTC | All open bot-authored PRs (not limited to Dependabot) | Flags any that are conflicting or long-unreviewed to Slack. |

### Enabling auto-merge isn't the same as merging

`dependabot-auto-merge.yml` only flips a flag on the PR. GitHub itself completes the merge later, automatically, once both the required human approval and all required status checks pass. If either never happens, the PR just sits with auto-merge armed but unfulfilled — nothing forces it through.

## Slack posts

Three of the four workflows post to Slack. All of them use the `SECURITY_ALERTS_SLACK_WEBHOOK` secret, so every post lands in the one channel that webhook was created for. A run that has nothing to report posts nothing.

| Workflow | Posts? | What a post contains | When it posts |
|---|---|---|---|
| `dependabot-auto-merge.yml` | No | Nothing. Its results are only in the Actions log, including a warning when it skips a PR that touches shared code. | Never. |
| `security-findings-notify.yml` | Yes | One message per Dependabot alert (critical and high only): a label (`New finding`, `SLA at risk` or `SLA breached`), the severity, days open, a link to the alert with its GHSA ID, and the advisory summary. A critical alert that breaches its SLA starts with `@here`. | Checked every 6 hours. Each alert posts once per status (new, then at risk, then breached). A breached alert repeats once a day while it stays open. |
| `stale-bot-pr-notify.yml` | Yes | One combined message, "Bot PRs needing attention". Each line has the PR number and title as a link, the author, the age in days, and a reason: `conflicting`, `CI failing` (a required check failed) or `unreviewed`. | Checked daily at 13:00 UTC. Posts only if at least one PR is flagged. There is no dedup, so a PR repeats every day until it is fixed. |
| `outdated-kilo-deps.yml` | Yes | One short summary, "Outdated Kilo-owned dependencies: N major, N minor, N patch". It lists the major and minor updates with current and latest versions. Patch updates are only counted. A link to the run has the full list. | Checked monthly, on the 1st at 09:23 UTC. Posts only if something is outdated. |

## Fork-safety notes

kilocode is a fork of opencode sharing one `bun.lock` with upstream-owned `@opencode-ai/*` packages. Two things exist specifically to avoid friction with upstream syncs:

- `dependabot-auto-merge.yml` only auto-merges a PR if every changed file (besides the shared `bun.lock`) lives under a `kilo`-named path. Anything touching shared/upstream code is left for a human.
- The root `bun` block has version updates turned off. It scans ~17 upstream-owned packages and cannot be scoped by path, so its PRs almost always touched upstream files. Those dependencies come in with upstream merges.
- `dependabot.yml` deliberately does **not** cover `packages/opencode/Dockerfile` or `.github/workflows/**`: both are shared/upstream paths that the auto-merge guard above would never approve anyway, and `.github/workflows/**` changes routinely fail this repo's `kilocode_change` annotation check unless they land inside an existing marker block. Those paths are covered by `security-findings-notify.yml` instead, which only reads GitHub's alerts, it never proposes a PR.
