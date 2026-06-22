---
title: "Measure adoption, quality, and cost"
description: "Track lightweight adoption, task outcomes, workflow coverage, spend, blockers, and participant sentiment."
---

# Measure adoption, quality, and cost

Measure only what you need to make the rollout decision. Keep the dataset privacy-minimal and avoid collecting prompts, generated code, secrets, or customer data in evaluation records.

## Recommended metrics

| Metric | What it does | What it does not prove |
|---|---|---|
| Invited participants | Shows who was asked to join | Eligibility, activation, or usage |
| Activated participants | Shows who completed setup and used Kilo at least once | Sustained adoption or value |
| Weekly active participants | Shows who used Kilo during each measured week | Depth, quality, or ROI |
| Repeat active participants | Shows whether people returned after first use | Productivity or broad rollout success |
| Tasks attempted or logged | Shows evaluation task volume | That all work was valuable or complete |
| Task outcome split | Shows accepted, useful with rework, rejected, and blocked work | Independent quality unless reviewed |
| Workflow coverage | Shows which approved categories were represented | That untested workflows are ready |
| Spend to date | Shows current cost for tracked usage | Future rollout cost by itself |
| Spend by model/provider | Shows cost concentration where available | Complete cost if usage bypasses the measured path |
| Blockers | Shows setup, workflow, policy, or support issues | Whether Kilo is unsuitable without context |
| Participant sentiment | Shows perceived usefulness and friction | Objective quality or verified savings |

Usage is not ROI. Satisfaction is not quality. Self-reported time saved is not verified labor savings.

## Use product analytics where they apply

Use existing Kilo usage and billing views where they match your evaluation scope:

- [Analytics](/docs/collaborate/teams/analytics)
- [AI Adoption Dashboard](/docs/collaborate/adoption-dashboard/overview)
- [Dashboard](/docs/collaborate/teams/dashboard)
- [Gateway Usage & Billing](/docs/gateway/usage-and-billing)

Confirm the measurement boundary before launch. For example, team analytics describe Kilo Gateway usage and do not cover every possible direct-provider path. If measured work uses paths outside the available analytics, keep those results separate or lower confidence in the spend and usage conclusions.

## Privacy-minimal measurement

Do not collect these items in task logs, surveys, or evaluation notes:

- Prompts
- Model responses
- Generated code
- Secrets, credentials, tokens, or API keys
- Customer data
- Sensitive personal information
- Repository, branch, file, ticket, or commit details in free text

If your organization needs identity, repository, or artifact mappings, keep them in customer-controlled systems with appropriate access controls. The evaluation summary can use aggregates and content-free references.

## Task log template

Ask participants to log meaningful tasks quickly. One row per task is enough.

| Field | Example |
|---|---|
| Date | `2026-07-15` |
| Participant ID | `P03` |
| Workflow category | `Tests` |
| Kilo surface | `IDE` |
| Model/provider category | `Approved default` |
| Complexity | `Low / Medium / High` |
| Outcome | `Accepted / Useful after rework / Rejected / Blocked / Still in progress` |
| Normal checks completed | `Yes / No / Not applicable` |
| Human review completed | `Yes / No / Not applicable` |
| Blocker category | `Access / Quality / Latency / Cost / Policy / Unsupported workflow / None` |
| Content-free note | `Optional. Do not include prompts, code, secrets, customer data, or repository details.` |

Recommended outcome meanings:

| Outcome | Meaning |
|---|---|
| Accepted | The result was used after normal review and required checks |
| Useful after rework | Kilo helped, but material human edits or retries were needed |
| Rejected | The output was not useful enough to use |
| Blocked | The participant could not complete the task because of access, workflow, policy, or technical blockers |
| Still in progress | The task is not ready to judge yet |

## Weekly pulse template

Send a short pulse at the end of each measured week. Keep it under two minutes.

| Question | Response type |
|---|---|
| Did you use Kilo for approved work this week? | `Yes / No` |
| Which approved workflow was most useful? | Single select from your workflow categories |
| What was your biggest blocker? | `Access / Setup / Quality / Latency / Cost / Policy / Unsupported workflow / No suitable task / None / Other` |
| How satisfied were you with Kilo this week? | `1 very dissatisfied` to `5 very satisfied` |
| Would you keep using Kilo for this type of work? | `Yes / Maybe / No` |
| Did you encounter a safety, security, privacy, or policy concern? | `Yes / No`, with reporting instructions outside the survey if yes |
| Optional content-free note | Free text with a reminder not to include prompts, code, secrets, customer data, or repository details |

## Read the signals together

Avoid making the decision from one metric. For example:

| Pattern | Likely interpretation |
|---|---|
| High activation, low repeat usage | Setup worked, but ongoing value or task fit may be weak |
| Low activation, strong satisfaction among active users | Onboarding or access may have limited the evidence |
| High task volume, many rejected outcomes | Adoption exists, but quality or workflow fit may be poor |
| Good outcomes, spend above tolerance | Rollout may need model/provider guidance or budget controls |
| Promising usage, few logged tasks | Evidence is thin; a short extension may be better than GO |
