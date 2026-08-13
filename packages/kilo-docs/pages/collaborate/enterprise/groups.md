---
title: "Groups"
description: "Organize members into groups and compose policies like model access"
---

# Groups

{% callout type="info" %}
This is an **Enterprise-only** feature. The Groups page and policy enforcement are available only to organizations on the Enterprise plan.
{% /callout %}

**Groups** let you organize members of your organization and attach **policies** to them, without creating sub-organizations. Groups are flat (no nesting) and a member can belong to any number of groups.

**Model access** is the first policy type. It grants models and providers to the members of a group, layered on top of the organization-wide [Model Access Controls](/docs/collaborate/enterprise/model-access-controls). More policy types are planned.

## Roles

| Role | What they can do |
|---|---|
| Owner | Create, edit, and delete groups; manage members and policies |
| Billing manager | View groups and policy settings (read-only) |
| Member | See the names of the groups they belong to |

## Managing groups

Open **Groups** in your organization's sidebar on the [Organization dashboard](https://app.kilo.ai).

1. Click **Create group**
2. Give the group a name and optional description
3. Add members
4. Add policies

Deleting a group removes the group, its policies, and its member assignments. Members keep whatever access the organization defaults and their remaining groups grant.

## Model access policies

A model access policy has one of three modes:

| Mode | Effect |
|---|---|
| **All** | Grants every model and provider |
| **Selected** | Grants only the models and providers you select |
| **None** | Grants nothing |

Policies compose in layers:

- **Default policies** apply to every direct member before their group policies are combined. Manage them from the **Group policies** card on the Groups page.
- **Group policies** apply to the group's members. A member in several groups gets the union of those grants.

A member's effective access is the organization ceiling intersected with the default policies plus the union of their group grants:

- Absence of configuration is never a restriction — if no default or group policy applies to a member, their access is unchanged.
- Group grants cannot exceed the organization-wide [Model Access Controls](/docs/collaborate/enterprise/model-access-controls). Models and providers blocked there stay blocked for everyone, and the policy editor marks out-of-ceiling entries as unavailable.
- Only an explicit **None** mode, or a **Selected** mode with nothing selected, results in no access.

Policy changes are enforced everywhere members use models, including the extension, the CLI, autocomplete, and the Slack, Discord, Linear, and GitHub integrations.
