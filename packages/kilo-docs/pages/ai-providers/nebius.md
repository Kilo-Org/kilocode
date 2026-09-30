---
title: "Using Nebius Token Factory with Kilo Code | Nebius Inference"
description: "Configure Nebius Token Factory in Kilo Code — locally with your own API key, shared across your team via BYOK in Kilo Cloud, or org-wide through the Kilo Gateway."
sidebar_label: Nebius Token Factory
---

# Using Nebius Token Factory With Kilo Code

Nebius Token Factory provides inference for a wide range of models on Nebius infrastructure. You can connect it to Kilo Code three ways:

1. **Locally** — add your own API key in the VS Code extension, JetBrains plugin, or CLI.
2. **In Kilo Cloud** — store the key as a BYOK key so Cloud Agents and your team can use it.
3. **Org-wide via Kilo Gateway** — let organization owners control which Nebius models and regions your team can use.

**Website:** [https://nebius.com/](https://nebius.com/)

## Prerequisites

- A [Nebius Token Factory](https://nebius.com/) API key
- Kilo Code installed: the [VS Code extension](/docs/code-with-ai/platforms/vscode), [JetBrains plugin](/docs/code-with-ai/platforms/jetbrains), or [CLI](/docs/code-with-ai/platforms/cli)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [Nebius Token Factory](https://tokenfactory.nebius.com/) and create an account or sign in.
2. **Create a Key:** Open the API Keys section and create a new API key.
3. **Copy the Key:** Copy the key and store it securely.

## Add Your Key Locally

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Show more providers** and select **Nebius Token Factory**.
3. Paste your API key and save.

{% image src="/docs/img/nebius/vscode-find-provider.png" alt="VS Code provider catalog showing Nebius Token Factory" width="800" caption="Find the Nebius Token Factory provider" /%}

{% image src="/docs/img/nebius/vscode-api-key.jpg" alt="VS Code dialog to enter the Nebius Token Factory API key" width="600" caption="Set your API key for the Nebius Token Factory" /%}

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="JetBrains" %}

1. Open **Settings** and go to the **Providers** tab.
2. Click **Show more providers** and select **Nebius Token Factory**.
3. Paste your API key and save.

{% /tab %}
{% tab label="CLI" %}

Run `kilo` and use the `/connect` command to add your Nebius Token Factory API key interactively.

{% image src="/docs/img/nebius/cli-connect.png" alt="Kilo CLI /connect command with Nebius Token Factory selected" width="600" caption="Get the key connected in the Kilo CLI with the /connect command" /%}

Alternatively, set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export NEBIUS_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "nebius": {
      "env": ["NEBIUS_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "nebius/moonshotai/Kimi-K2.5",
}
```

{% /tab %}
{% /tabs %}

## Select a Nebius Model

Once your key is configured, open the model picker and select any model tagged **Nebius Token Factory**. Model IDs use the `nebius/<vendor>/<model>` format (for example, `nebius/moonshotai/Kimi-K2.5`). See the [Nebius Token Factory docs](https://docs.tokenfactory.nebius.com/) for the full model list.

{% image src="/docs/img/nebius/vscode-model-picker.jpg" alt="VS Code model picker showing models tagged Nebius Token Factory" width="600" caption="Select any model tagged Nebius Token Factory" /%}

## Share Your Key With Your Team (Kilo Cloud BYOK)

Storing your key as a [BYOK (Bring Your Own Key)](/docs/getting-started/byok) key in Kilo Cloud makes it available to Cloud Agents and, at the organization level, to every member of your team through a shared usage pool. Requests are billed directly by Nebius at your account's rates — Kilo adds no markup.

1. Log into the Kilo platform and select your personal account or the organization you want to add the key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under **Account**.
3. Click **Add API Key**, select **Nebius Token Factory** as the provider, and paste your key.
4. Save.

{% image src="/docs/img/nebius/cloud-byok.png" alt="Kilo Cloud BYOK page with the Add API Key dialog and Nebius Token Factory selected as provider" width="800" caption="Add API Key dialog with Nebius Token Factory selected as provider" /%}

Organization-level keys apply to all members of the organization and require owner or billing manager access to manage. For details on how BYOK routing works, see [Bring Your Own Key (BYOK)](/docs/getting-started/byok).

## Control Nebius Access Org-Wide (Kilo Gateway)

{% callout type="info" %}
Model access controls are an **Enterprise-only** feature. Organizations on other plans have unrestricted access to all models and providers.
{% /callout %}

The [Kilo Gateway](/docs/gateway) provides access to 500+ models from 60+ providers, including Nebius Token Factory. As an organization owner, you can control which models and provider routes your team can use:

1. Navigate to your organization's **Providers & Models** page.
2. Enable **Nebius Token Factory** on the **Providers** tab.
3. Choose which models and regions your team is allowed to use. You can filter providers by data policy (trains on data, retains prompts) and datacenter location.

{% image src="/docs/img/nebius/gateway-allowlist.png" alt="Kilo Gateway provider list showing Nebius Token Factory enabled, with region and training-data filters" width="800" caption="Kilo Gateway provider allowlist showing Nebius Token Factory enabled, with region and training-data filters" /%}

Team members can then select the approved Nebius models through the Kilo Gateway. For details, see [Model Access Controls](/docs/collaborate/enterprise/model-access-controls).

## Tips and Notes

- **Model Selection:** Nebius Token Factory offers a wide range of models. Experiment to find the best one for your needs.
- **Pricing:** You pay Nebius directly based on your usage. See the [Nebius Token Factory pricing](https://nebius.com/prices) page for current rates.
- **BYOK badge:** When you use the Kilo Gateway provider, models that can use one of your saved personal or organization BYOK keys display a `BYOK` badge in the model picker.
