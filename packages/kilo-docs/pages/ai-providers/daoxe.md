---
title: "Using DaoXE with Kilo Code"
description: "Connect Kilo Code to DaoXE's multi-model API gateway with an API key and an account-available model ID."
sidebar_label: DaoXE
---

# Using DaoXE With Kilo Code

[DaoXE](https://daoxe.com) is a multi-model API gateway available in Kilo Code through the OpenAI-compatible provider catalog. Kilo Code uses the `daoxe` provider ID and reads your API key from `DAOXE_API_KEY`.

{% callout type="warning" %}
DaoXE is not available in mainland China. Requests from mainland China may be blocked or rejected.
{% /callout %}

## Before you begin

1. Create an account at [daoxe.com](https://daoxe.com).
2. Create an API key in your DaoXE dashboard.
3. Choose an exact model ID available to your account. Model availability and pricing can change, so check the live catalog instead of copying an old model list.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **DaoXE**. If it is not visible, click **Show more providers**.
3. Enter your DaoXE API key.
4. Select a model that is available to your DaoXE account.

The extension stores the provider configuration in your `kilo.json` file. You can also configure it directly using the CLI format below.

{% /tab %}
{% tab label="CLI" %}

Set your API key in the environment:

```bash
export DAOXE_API_KEY="your-api-key"
```

Configure the provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "daoxe": {
      "env": ["DAOXE_API_KEY"],
    },
  },
}
```

Set your default model using the `provider-id/model-id` format:

```jsonc
{
  "model": "daoxe/your-account-model-id",
}
```

Replace `your-account-model-id` with an exact model ID available to your account.

{% /tab %}
{% /tabs %}

## API compatibility

Kilo Code connects to DaoXE through the OpenAI-compatible API at `https://daoxe.com/v1`. DaoXE also exposes OpenAI Responses, Anthropic Messages, and image-generation-compatible endpoints, but the provider configuration on this page uses Kilo Code's OpenAI-compatible chat path.

For standalone cURL, Node.js, Python, Postman, and Claude Code examples, see the [DaoXE-AI examples repository](https://github.com/seven7763/DaoXE-AI).

## Troubleshooting

- **Invalid API key:** Create a new key in your DaoXE dashboard and update `DAOXE_API_KEY`.
- **Model not found:** Copy an exact model ID available to your account. Do not rely on a static model list.
- **Provider not visible:** Refresh Kilo Code's provider catalog, then check **Show more providers**.
- **Connection rejected:** Confirm that you are using the service from an available region.

{% callout type="note" %}
This documentation was contributed by a DaoXE affiliate.
{% /callout %}
