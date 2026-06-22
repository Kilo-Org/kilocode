---
title: "Set up your evaluation"
description: "Configure organization access, model controls, spend visibility, integrations, and participant onboarding."
---

# Set up your evaluation

Use this page as a setup checklist. Follow the linked setup docs for product-specific steps instead of duplicating them in your evaluation plan.

## Setup checklist

| Step | Action | Reference |
|---|---|---|
| 1 | Create or use the right organization or team | [Getting Started with Teams](/docs/collaborate/teams/getting-started) |
| 2 | Confirm owner/admin access for the people running setup | [Team Management](/docs/collaborate/teams/team-management) |
| 3 | Invite only the approved participants | [Team Management](/docs/collaborate/teams/team-management) |
| 4 | Confirm participants use the right organization context | [Team Billing](/docs/collaborate/teams/billing) |
| 5 | Configure SSO if required | [SSO](/docs/collaborate/enterprise/sso) |
| 6 | Configure model/provider controls if applicable | [Model Access Controls](/docs/collaborate/enterprise/model-access-controls) |
| 7 | Configure Gateway spend controls if applicable | [Gateway Usage & Billing](/docs/gateway/usage-and-billing) |
| 8 | Confirm analytics and billing visibility | [Analytics](/docs/collaborate/teams/analytics) and [Dashboard](/docs/collaborate/teams/dashboard) |
| 9 | Configure repository integrations only where relevant | [Integrations](/docs/automate/integrations) |
| 10 | Set up approved Kilo surfaces | [Installation](/docs/getting-started/installing), [CLI](/docs/code-with-ai/platforms/cli), [Cloud Agent](/docs/code-with-ai/platforms/cloud-agent), [Code Reviews](/docs/automate/code-reviews/overview) |
| 11 | Confirm the support and escalation path | Your internal support channel |
| 12 | Send participant onboarding instructions | [Participant onboarding checklist](#participant-onboarding-checklist) |

## Organization and access

Use the organization or team that matches the evaluation scope. If you are evaluating an enterprise rollout, make sure participants are invited to the intended organization and understand how to select that organization context in Kilo.

Do not mix personal and organization usage in measured results unless you have a specific reconciliation plan. If organization analytics are part of the evaluation, confirm what usage they include before the measured period starts. See [Analytics](/docs/collaborate/teams/analytics).

## Identity and SSO

If your organization requires SSO, configure it before the measured period starts. The SSO setup process may require coordination with Kilo and your identity provider, so plan lead time. See [SSO](/docs/collaborate/enterprise/sso).

## Models, providers, and spend

Set model/provider expectations before participants begin measured work.

Use the controls that match your chosen traffic path:

| Need | Reference |
|---|---|
| Limit models or providers in Enterprise organization settings | [Model Access Controls](/docs/collaborate/enterprise/model-access-controls) |
| Use Gateway organization balances, allow lists, and per-user daily limits | [Gateway Usage & Billing](/docs/gateway/usage-and-billing) |
| Use your own provider keys through Gateway | [Bring Your Own Key (BYOK)](/docs/getting-started/byok) |
| Understand available AI providers | [AI Providers](/docs/ai-providers) |

## Repository integrations

Configure repository integrations only if your evaluation includes hosted repository workflows such as Cloud Agent or hosted Code Reviews.

Relevant docs:

- [Integrations](/docs/automate/integrations)
- [Cloud Agent](/docs/code-with-ai/platforms/cloud-agent)
- [Code Reviews](/docs/automate/code-reviews/overview)

Confirm the repository scope matches what your organization approved. Use normal repository permissions and review controls.

## Support path

Before launch, tell participants where to report:

- Access or setup problems
- Unsupported workflow or repository issues
- Model/provider or cost questions
- Quality concerns
- Security, privacy, or policy concerns

Define who can pause the evaluation if a critical issue occurs.

## Participant onboarding checklist

Copy this into the onboarding message for participants.

| Item | Participant instruction |
|---|---|
| Evaluation dates | `Use Kilo for approved work between [start] and [end].` |
| Organization context | `Use [organization/team name], not your personal context, for measured work.` |
| Approved surfaces | `Use only [IDE / CLI / Cloud Agent / Code Reviews] for this evaluation.` |
| Approved workflows | `Use Kilo for [workflow categories]. Do not use it for excluded workflows.` |
| Approved models/providers | `Use [approved model/provider guidance].` |
| Data boundaries | `Do not enter secrets, credentials, sensitive personal information, or unapproved customer data.` |
| Normal controls | `Keep using normal review, tests, scans, branch protection, and deployment rules.` |
| Task logging | `Log each meaningful task with outcome and blocker status. Do not include prompts, code, customer data, secrets, or repository details in free text.` |
| Weekly pulse | `Complete the weekly pulse survey. Keep free-text answers content-free.` |
| Help path | `Report blockers or policy concerns in [channel/contact].` |

## Pre-launch check

Before the measured period starts, verify:

- Participants can sign in and access the right organization
- The selected Kilo surfaces work in the approved environments
- Model/provider expectations are visible to participants
- Spend and usage views are accessible to the right admins
- Repository integrations work only for the approved scope
- The support path is staffed
- Participants received onboarding instructions
