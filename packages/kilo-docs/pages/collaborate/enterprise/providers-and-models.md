---
title: "Providers & Models"
description: "Control which AI providers and models your organization members can use"
---

# Providers & Models

{% callout type="info" %}
This is an **Enterprise-only** feature. It is not available on Teams plans.
{% /callout %}

**Providers & Models** lets organization owners control which AI providers and models are available to all members of the organization. By default, all providers and models are allowed. Owners can selectively disable specific providers or models to enforce data policy, compliance, or cost requirements.

## Accessing the Feature

1. Open the [Kilo dashboard](https://kilo.ai).
2. Navigate to your organization.
3. Select **Providers & Models** from the organization sidebar.

## How It Works

The feature uses a **blocklist** approach: everything is allowed by default, and owners explicitly disable what should be restricted. This means:

- New providers and models added to the platform are automatically available to your organization unless you block them.
- Blocking a provider disables all of its models for organization members.
- Disabling a model removes it from the **Models** tab for all members, regardless of which provider serves it.

Non-enterprise organizations have unrestricted access to all models and providers — the Providers & Models page is visible but not editable.

## Models Tab

The **Models** tab shows all available AI models. Each row displays the model name, the providers that offer it, and its current allowed/blocked status.

**Actions:**

- **Enable / Disable**: Toggle the checkbox next to a model to allow or block it for all organization members.
- **Search**: Use the search box to filter by model name, model ID, or provider name.
- **Show enabled only**: Check the "Enabled" filter to show only currently allowed models.
- **Model details**: Click the info icon on any model to view its description, context length, input/output modalities, and per-provider pricing and data policies.

## Providers Tab

The **Providers** tab shows all available AI providers. Each row displays the provider name, its data policy indicators, and the number of models it offers.

**Actions:**

- **Enable / Disable**: Toggle the checkbox next to a provider to allow or block all of its current and future models.
- **Search**: Use the search box to filter providers by name or slug.
- **Show enabled only**: Check the "Enabled" filter to show only currently enabled providers.
- **Provider details**: Click the info icon on any provider to view its models, pricing, and data policies.

**Filters:**

| Filter                | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| **Trains**            | Filter providers by whether they use data to train AI models (Yes / No / All). |
| **Retains prompts**   | Filter providers by whether they retain user prompts (Yes / No / All).         |
| **Provider location** | Filter by provider headquarters or datacenter country.                         |

## Data Policy Indicators

Each provider row shows policy tags when applicable:

| Tag                | Meaning                                                   |
| ------------------ | --------------------------------------------------------- |
| **Trains**         | The provider uses prompts/completions to train AI models. |
| **Retains prompt** | The provider retains user prompts after the request.      |
| **Publishes**      | The provider may publish user content.                    |

## Saving Changes

Changes are not applied until you explicitly save them. A status bar appears at the bottom of the page when you have unsaved changes, showing the current count of enabled providers and models. Click **Save** to apply or **Cancel** to discard.

## Permissions

- Only **Owners** of an enterprise organization can enable or disable providers and models. Members with other roles can view the page in read-only mode.
- Changes propagate to all organization members within seconds of saving.
- Individual users cannot override organization-level restrictions.

## Example Use Cases

- **Data residency**: Disable all providers with datacenters outside your required region.
- **Compliance**: Block providers that retain prompts or train on user data.
- **Cost control**: Disable high-cost model families to keep usage within budget.
- **Standardization**: Enable only the specific models your team has approved, reducing decision fatigue for individual users.
