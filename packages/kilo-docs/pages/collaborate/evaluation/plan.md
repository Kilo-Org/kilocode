---
title: "Plan your evaluation"
description: "Define scope, participants, workflows, models, success criteria, spend expectations, and safe-use boundaries."
---

# Plan your evaluation

Plan the evaluation before inviting participants. Keep the plan short enough to use, but explicit enough that everyone knows what is in scope.

## Choose an owner

Pick one sponsor or champion who can:

- State the decision the evaluation must support
- Select or confirm the participant cohort
- Coordinate admins, team leads, and support contacts
- Keep scope changes visible
- Prepare the final GO, EXTEND, or NO-GO recommendation

## Choose participants

Select a small cohort that represents the rollout you are considering. Avoid a group made only of AI enthusiasts or only one unusually advanced team unless that is the actual rollout target.

Good cohorts usually include:

- Engineers from the teams or workflows you expect to expand to next
- A mix of experience levels with the codebase and AI coding tools
- People with enough normal work during the evaluation window to try Kilo on real tasks
- Team leads who will keep normal review and validation expectations in place

## Choose approved workflow categories

Define the types of work participants may use Kilo for. Examples:

| Workflow category | Example use |
|---|---|
| Implementation | Build a small feature or code path |
| Tests | Add or update unit, integration, or regression tests |
| Debugging | Investigate a failing test, bug, or runtime issue |
| Refactoring | Improve structure without changing behavior |
| Review | Review local changes or pull requests |
| Documentation | Explain code or update developer-facing docs |

Keep the list small. If a workflow is required for rollout, make sure it is represented during the evaluation.

## Choose approved models and providers

Decide which models and providers participants should use for measured work. Where applicable, configure controls using existing organization or Gateway settings instead of relying only on instructions.

Useful setup references:

- [Model Access Controls](/docs/collaborate/enterprise/model-access-controls)
- [Gateway Usage & Billing](/docs/gateway/usage-and-billing)
- [Bring Your Own Key (BYOK)](/docs/getting-started/byok)
- [AI Providers](/docs/ai-providers)

## Choose approved Kilo surfaces

Choose only the Kilo surfaces that are supported, configured, and approved for your evaluation.

| Surface | Setup reference |
|---|---|
| IDE | [Installation](/docs/getting-started/installing) |
| CLI | [CLI](/docs/code-with-ai/platforms/cli) |
| Cloud Agent | [Cloud Agent](/docs/code-with-ai/platforms/cloud-agent) |
| Code Reviews | [Code Reviews](/docs/automate/code-reviews/overview) |

If a surface depends on a repository integration, confirm the integration and repository scope before including it. See [Integrations](/docs/automate/integrations).

## Define success criteria

Define success criteria before usage begins. Use observable signals, not broad claims.

Example criteria:

- Most target participants activate and use Kilo during the evaluation
- Meaningful repeat usage occurs across the measured period
- Logged tasks cover the approved workflow categories that matter for rollout
- Most determinate task outcomes are accepted or useful after normal review
- Spend is acceptable for the measured cohort and expected rollout size
- No unresolved critical security, privacy, legal, or policy issue exists

## Define spend expectations

Set an expected spend range or budget threshold before launch. Decide who watches spend and what happens if spend approaches the threshold.

Use the relevant billing and usage docs for setup details:

- [Team Billing](/docs/collaborate/teams/billing)
- [Team Analytics](/docs/collaborate/teams/analytics)
- [Gateway Usage & Billing](/docs/gateway/usage-and-billing)

## Confirm security, legal, and data boundaries

Before participants start, confirm:

- Which data classes are allowed
- Which repositories or repository classes are allowed
- Which models, providers, and traffic paths are approved
- Whether SSO or organization-managed access is required
- Who can pause the evaluation for security, privacy, legal, or policy reasons
- Where participants should report blockers or policy concerns

Participants should not enter:

- Secrets, API keys, access tokens, or credentials
- Production customer data unless explicitly approved by your organization
- Sensitive personal information
- Contract, legal, or sensitive business text not approved for AI use
- Prompts, generated code, or repository details into survey or task-log free text

Continue using normal code review, testing, branch protection, security scanning, and deployment controls. An evaluation should not bypass the controls you use for ordinary engineering work.

## Planning checklist

Copy this checklist into your team workspace and fill in the right column.

| Item | Decision |
|---|---|
| Sponsor or champion | `[Name / role]` |
| Evaluation dates | `[Setup date, start date, end date]` |
| Target cohort | `[Teams / roles / participant count]` |
| Approved workflow categories | `[Implementation, tests, debugging, refactor, review, documentation, other]` |
| Required workflow categories | `[Categories that must be represented to decide GO]` |
| Approved Kilo surfaces | `[IDE, CLI, Cloud Agent, Code Reviews]` |
| Approved organization context | `[Organization name or team]` |
| Approved models/providers | `[List or policy reference]` |
| Approved repositories or repository classes | `[Scope or customer-controlled reference]` |
| Data participants must not enter | `[Data classes or examples]` |
| Success criteria | `[Activation, repeat usage, task outcomes, spend, blockers]` |
| Spend expectation or threshold | `[$ amount or policy]` |
| Analytics and billing reviewer | `[Name / role]` |
| Support and escalation path | `[Channel / owner]` |
| Stop conditions | `[Security, privacy, policy, quality, spend, or adoption triggers]` |
