---
title: "Security Reviews"
description: "Contextualize dependency vulnerabilities with AI"
---

# Security Reviews

Most teams are drowning in Dependabot alerts. The majority of reported CVEs aren't actually exploitable because the vulnerable code path is never used — but figuring that out manually doesn't scale.

Kilo's Security Agent fixes this. It syncs your Dependabot alerts, triages them with AI, and performs deep codebase analysis to determine whether each vulnerability is actually reachable in your code. Non-exploitable findings can be auto-dismissed and synced back to GitHub.

Available on **Teams** and **Enterprise** plans.

---

## Prerequisites

You need three things before enabling Security Reviews:

1. The [KiloConnect GitHub App](/docs/automate/integrations#connecting-github) installed with `vulnerability_alerts` permission
2. [Dependabot alerts](https://docs.github.com/en/code-security/dependabot/dependabot-alerts) enabled on your target repositories
3. Kilo Code credits for AI model usage

---

## Get started

1. Go to the **Security Agent** page — either from your [personal dashboard](https://app.kilo.ai/security-agent) or your organization's dashboard
2. Connect GitHub if you haven't already via the [Integrations page](/docs/automate/integrations)
3. Choose which repositories the agent should monitor (all or specific ones)
4. Toggle the agent on — this kicks off an initial sync of your Dependabot alerts

The agent syncs alerts every 6 hours automatically after that. You can trigger a manual sync at any time from the Findings page.

---

## Understand the pipeline

The Security Agent processes each vulnerability alert through four stages.

**Sync** pulls Dependabot alerts from your connected repositories on a 6-hour cycle.

**Triage** runs a quick LLM assessment of the alert metadata — the advisory, severity, package, and version range. Each finding gets classified as **Safe to Dismiss**, **Needs Analysis**, or **Needs Review**.

**Deep analysis** kicks in for findings that warrant it. The Cloud Agent performs a full codebase search for actual usage of the vulnerable package, checks whether the vulnerable code paths are reachable, and suggests fixes when possible.

**Auto-dismiss** (when enabled) automatically closes non-exploitable findings and syncs that dismissal back to GitHub with a `[Kilo Code auto-dismiss]` prefix.

---

## Choose an analysis mode

You control how much analysis the agent performs via three modes:

| Mode | What happens |
|---|---|
| **Auto** | Triage first, then deep analysis only when triage recommends it |
| **Shallow** | Triage only — no deep analysis |
| **Deep** | Full codebase analysis for every finding, regardless of triage result |

**Auto** is the default. It gives you the best balance between thoroughness and credit usage — deep analysis only runs where triage says it's needed.

---

## Use the dashboard

The dashboard is the Security Agent's landing page. It gives you a high-level view of your security posture, and every widget links through to the Findings page with the relevant filters applied. Use the repository filter at the top to scope everything to specific repos.

**SLA compliance** is the hero metric — your overall compliance percentage with a per-severity breakdown, linking directly to any overdue findings.

**Severity breakdown** shows open finding counts across Critical, High, Medium, and Low in a 2×2 grid. Click any severity to see those findings.

**Finding status** is a donut chart of Open, Fixed, and Dismissed findings. Click a segment to filter the Findings page.

**Analysis coverage** shows a progress bar of analyzed vs. total findings, with an outcome breakdown (Exploitable, Not Exploitable, Safe to Dismiss, etc.).

**Mean time to resolution** compares your average resolution time per severity against your configured SLA targets.

**Overdue findings** lists the top 10 findings past their SLA deadline — severity, title, repo, package, and how many days overdue.

**Repository health** is a per-repo summary with severity counts, overdue count, and SLA compliance percentage.

---

## Browse findings

The Findings page is where you work through your vulnerability backlog. At the top, a summary bar shows open/closed counts, your current analysis capacity, when the last sync ran, and a **Sync** button for manual refreshes.

Filter findings by repository, severity, outcome, or sort order to focus on what matters most. Each row shows a severity badge, the finding title and package name, its current outcome label, and an action button — **Analyze**, **Retry**, **Review**, or **View Details** depending on state.

Findings past their SLA deadline are highlighted in red so they're easy to spot. The page paginates at 20 results and auto-refreshes every 5 seconds when analyses are running.

---

## Inspect a finding

Click any finding to open its detail dialog. There are three tabs.

The **Details** tab shows the vulnerability metadata — package name and ecosystem, CVE and GHSA IDs, the vulnerable and patched version ranges, manifest path, and a full description. You'll also find a **View on GitHub** link to the original Dependabot alert, plus detection and last sync dates.

The **Triage** tab shows the agent's initial assessment: a suggested action badge (Safe to Dismiss, Needs Analysis, or Needs Review), a confidence level, and the reasoning behind the decision. If triage hasn't run yet, you can start it here. If it failed, you can retry.

The **Analysis** tab shows the deep analysis results when available — whether the vulnerability is exploitable or not, a summary, up to 5 usage locations found in your codebase, a suggested fix, and full analysis details. There's also a link to continue the investigation in Cloud Agent if you want to dig deeper.

---

## Understand statuses and outcomes

Every finding has a **primary status** and an **outcome label**. The status tracks the overall lifecycle, while the outcome reflects what the AI determined.

**Primary status:**

| Status | Meaning |
|---|---|
| Open | Active vulnerability that needs attention |
| Fixed | Resolved — detected from the Dependabot alert state |
| Dismissed | Closed by a user or by auto-dismiss |

**Outcome labels:**

| Outcome | Meaning |
|---|---|
| Not Analyzed | No analysis has run yet |
| Analyzing | Analysis is currently in progress |
| Analysis Failed | Something went wrong during analysis |
| Exploitable | Deep analysis confirmed it's exploitable |
| Not Exploitable | Deep analysis confirmed it's not reachable |
| Safe to Dismiss | Triage recommends dismissing this finding |
| Needs Review | Triage recommends manual review |
| Triage Complete | Triage is done, no deep analysis needed |

---

## Dismiss findings

There are two ways findings get dismissed.

**Manually**, you select a finding and choose **Dismiss**. You'll pick a reason — Fix started, No bandwidth, Tolerable risk, Inaccurate, or Not used — and optionally add a comment. The dismissal syncs back to GitHub and closes the corresponding Dependabot alert.

**Automatically**, when auto-dismiss is enabled, the agent closes findings on its own. After deep analysis, any finding determined to be not exploitable is dismissed immediately. After triage, findings with a "dismiss" recommendation are dismissed if they meet your configured confidence threshold. All auto-dismissed alerts are written back to GitHub with a `[Kilo Code auto-dismiss]` prefix.

---

## Configure the agent

All settings are on the Security Agent configuration page.

**Repository selection** lets you monitor all repositories accessible to the KiloConnect App or pick specific ones from a list.

**AI models** can be configured separately for triage and deep analysis. The default is Claude Opus 4.6.

**Analysis mode** controls the pipeline — Auto (triage then selective deep analysis), Shallow (triage only), or Deep (full analysis on everything). See [Choose an analysis mode](#choose-an-analysis-mode) for details.

**Auto-analysis** toggles whether new findings are analyzed automatically. When on, you set a minimum severity threshold (Critical only, High+, Medium+, or All) and whether to include findings that existed before you enabled the feature.

**Auto-dismiss** toggles automatic dismissal of non-exploitable findings. You configure a confidence threshold: High only, Medium+, or Any. The "Any" option dismisses at any confidence level — use it with caution.

**SLA deadlines** set how many days your team has to remediate findings at each severity level:

| Severity | Default |
|---|---|
| Critical | 15 days |
| High | 30 days |
| Medium | 45 days |
| Low | 90 days |

You can adjust these per your organization's policies and reset to defaults at any time.

---

## Clear orphaned findings

If repositories are removed from your GitHub integration or become inaccessible, their findings become orphaned. When this happens, a card appears on the settings page to permanently delete them.

{% callout type="warning" %}
Clearing orphaned findings is permanent and cannot be undone. Only do this when you're sure the repositories won't be reconnected.
{% /callout %}

---

## Compare with Code Reviews

Kilo offers two complementary security features that work best together.

[**Code Reviews**](/docs/automate/code-reviews/overview) analyzes PR diffs for code quality issues, including security patterns like `innerHTML` usage and hardcoded secrets. It catches problems in new code as it's written.

**Security Reviews** takes a different angle — it contextualizes dependency vulnerability alerts across your entire codebase to determine whether Dependabot-reported CVEs are actually exploitable based on how your code uses the affected packages.

Together, Code Reviews covers your new code surface and Security Reviews covers your dependency vulnerability surface.

---

## Limitations

Security Reviews currently works with **GitHub only** — GitLab support is not yet available.

The only data source right now is **Dependabot alerts**. Additional sources like npm audit and SBOM analysis are planned.

There is a **per-account limit** on concurrent analyses. If you have a large backlog, findings will be queued and processed in order.
