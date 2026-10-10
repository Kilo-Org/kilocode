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

The page has three tabs:

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

### Auto routing Tab

Holds your organization's Auto routing settings, including the Efficient model pool that constrains `kilo-auto/efficient` to specific model and thinking-variant pairs. Owners, admins, and billing managers can edit these settings; members see a read-only view. See [Custom Efficient pools](/docs/code-with-ai/agents/auto-model#custom-efficient-pools) for how the pool is benchmarked and routed.

### Saving Changes

A status bar appears at the bottom of the page whenever you have unsaved changes. Click **Save** to apply your changes, or **Cancel** to discard them. Changes take effect immediately for all team members once saved.

## Virtual models

Some catalog models do not have a provider of their own. They are still listed on the **Providers & Models** page and follow the same controls as any other model:

- **Latest aliases**, such as `~anthropic/claude-sonnet-latest`, appear under every provider that serves the standard model they point to, and use that provider's pricing and data policy. Access, routing, and data-collection rules treat an alias like its target model.
- **Routers and other provider-less models**, such as `openrouter/auto` or `typesafe/jev-router`, appear under a **Virtual** provider. A router picks a real provider per request, so its price shows as **Varies** instead of a fixed number; free routers are marked as potentially training on data.

Provider controls also decide how a router is routed:

- When your allowed providers include **Virtual**, a router can use the real providers on that same list. If the list has no real provider, the router is denied.
- With no provider allow list configured, routers are unrestricted, like any other model.
- **Virtual** is a Kilo-only slug and is never sent upstream; Kilo routes router requests to a real provider.

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
- To grant models to specific sets of members instead of the whole organization, use [Groups](/docs/collaborate/enterprise/groups). These organization-wide controls remain a hard ceiling that group grants cannot exceed.
