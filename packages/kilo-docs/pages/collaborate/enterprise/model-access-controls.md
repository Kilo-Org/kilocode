---
title: "Model Access Controls"
description: "Control which AI models your team can access"
---

# Model Access Controls

{% callout type="info" %}
This is an **Enterprise-only** feature. Organizations on other plans have unrestricted access to all models and providers.
{% /callout %}

**Model Access Controls** let organization owners block specific AI models or providers for all team members. The system uses a **blocklist** approach: everything is allowed by default, and admins explicitly block what should not be accessible.

This means newly added models and providers are automatically available to your team without any manual action required.

## How It Works

| Scenario | Behavior |
|---|---|
| No blocks configured | All models and providers are available (default) |
| Provider blocked | All current and future models from that provider are unavailable |
| Specific model blocked | Only that model is unavailable; other models from the same provider remain accessible |

## Managing Model Access

Navigate to your organization's **Providers & Models** page to configure access controls.

The page has two tabs:

### Models Tab

Lists all available models across all providers. For each model you can:

- Toggle access on or off
- Search by model name, ID, or provider
- Filter to show only currently allowed models

### Providers Tab

Lists all providers. For each provider you can:

- Toggle the entire provider on or off (blocks all current and future models from that provider)
- Filter by data policy (trains on data, retains prompts)
- Filter by provider location / datacenter region

When you toggle a provider off, all models it offers become unavailable to team members. Re-enabling the provider restores access to all its models.

### Saving Changes

A status bar appears at the bottom of the page whenever you have unsaved changes. Click **Save** to apply your changes, or **Cancel** to discard them. Changes take effect immediately for all team members once saved.

## Filtering Options

Use filters to find the models or providers you want to block:

| Filter | Tab | Description |
|---|---|---|
| **Search** | Models & Providers | Filter by name, ID, or provider slug |
| **Enabled only** | Models & Providers | Show only currently allowed items |
| **Trains on data** | Providers | Filter by whether the provider trains on user prompts |
| **Retains prompts** | Providers | Filter by whether the provider retains user prompts |
| **Location** | Providers | Filter by provider headquarters or datacenter country |

## Example Use Cases

- **Data compliance**: Block providers that train on prompts or operate outside your required data region.
- **Cost control**: Block high-cost models to prevent accidental expensive usage.
- **Security policy**: Restrict access to a known set of approved providers.

---

## Notes

- Only **Owners** can modify model access controls.
- Individual users cannot override organization-level restrictions.
- Blocking a provider blocks all its models, including models added by that provider in the future.
- Unblocking a provider immediately restores access to all its models.
