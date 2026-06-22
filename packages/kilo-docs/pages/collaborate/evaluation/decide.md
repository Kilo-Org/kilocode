---
title: "Make a rollout decision"
description: "Use observed evidence to choose GO, EXTEND, or NO-GO / STOP for your Kilo rollout."
---

# Make a rollout decision

At the end of the measured period, choose one decision: GO, EXTEND, or NO-GO / STOP. Keep the decision tied to observed evidence, unresolved risks, and the original evaluation scope.

## Separate facts from assumptions

Before deciding, separate what you observed from what you believe might happen later.

| Type | Examples |
|---|---|
| Observed facts | Activated participants, weekly active participants, logged task outcomes, workflow coverage, spend, blockers, incidents |
| Assumptions | Expected full-team adoption, future cost at scale, productivity improvement, rollout support needs |
| Unknowns | Untested workflows, missing analytics paths, unresolved policy questions, thin task volume |

Do not use assumptions to override a failed required workflow, unresolved critical issue, unacceptable quality, or materially above-tolerance spend.

## GO criteria

Choose GO when the evaluation shows enough evidence to expand under defined rollout conditions.

GO usually requires:

- Target participants activated at an acceptable rate
- Meaningful repeat usage occurred during the measured period
- Work happened in approved workflow categories that matter for rollout
- Logged outcomes were mostly accepted or useful after normal review
- Spend was acceptable for the measured scope and expected next rollout step
- No unresolved critical security, privacy, legal, or policy issue exists
- Blockers are understood and manageable during rollout

A GO decision can still include rollout conditions, such as a smaller first rollout group, approved model/provider guidance, budget thresholds, extra onboarding, or excluded workflows.

## EXTEND criteria

Choose EXTEND when the evidence is promising but too thin to support GO or NO-GO, and a short unchanged-scope extension can answer a specific question.

EXTEND is appropriate when:

- Setup or onboarding issues reduced participation
- There were too few logged tasks to judge the required workflows
- Usage is promising but repeat evidence is thin
- A required workflow needs a small amount of additional observed use
- A short extension can keep the same scope, success criteria, data boundaries, and budget expectations

Define one extension question, a short end date, and an automatic stop condition. Avoid repeated extensions that only defer the decision.

## NO-GO / STOP criteria

Choose NO-GO or STOP when the evaluation does not support rollout or should not continue.

NO-GO / STOP is appropriate when:

- Adoption remains weak after setup issues are resolved
- Required workflows are unsupported or cannot be evaluated reliably
- Quality is unacceptable after normal review and validation
- Spend is materially above tolerance or cannot be understood
- A critical security, privacy, legal, or policy issue occurs
- The evaluation cannot produce reliable evidence because the scope, data, or measurement path is too incomplete

For NO-GO / STOP, record what must change before trying again. Avoid turning unresolved product, policy, or workflow gaps into implied future commitments.

## Decision summary template

Copy this summary into your team workspace.

| Field | Summary |
|---|---|
| Decision | `GO / EXTEND / NO-GO / STOP` |
| Decision owner | `[Name / role]` |
| Evaluation dates | `[Start / end]` |
| Cohort | `[Invited, activated, weekly active, repeat active]` |
| Approved workflow coverage | `[Categories tested and not tested]` |
| Task outcomes | `[Accepted, useful after rework, rejected, blocked, still in progress]` |
| Quality summary | `[What normal review and checks showed]` |
| Spend summary | `[Spend to date, model/provider concentration if available, budget result]` |
| Blockers | `[Top blockers and status]` |
| Security/privacy/policy issues | `[None / resolved / unresolved]` |
| Observed facts supporting decision | `[Bullets or short paragraph]` |
| Assumptions not proven | `[ROI, productivity, future scale, untested workflows, or other assumptions]` |
| Unresolved risks | `[Risk, owner, next step]` |
| Rollout or closeout conditions | `[If GO: conditions. If EXTEND: question and end date. If NO-GO: re-entry condition.]` |

## Rollout conditions for GO

If the decision is GO, define the next step instead of opening access without guardrails.

Useful rollout conditions include:

- Which teams, repositories, or workflow categories are included next
- Which workflows remain excluded until tested
- Which models/providers participants should use
- Who monitors spend and usage
- What budget or spend threshold triggers review
- What onboarding participants receive
- What support channel and escalation path stay active
- When the rollout decision should be rechecked

## Closeout for EXTEND or NO-GO

For EXTEND, keep the scope unchanged unless you intentionally start a new evaluation. Changing the cohort, workflows, data boundaries, or model/provider policy makes the evidence harder to interpret.

For NO-GO / STOP, close out access and spend according to your organization process, document unresolved blockers, and state the re-entry condition clearly.
