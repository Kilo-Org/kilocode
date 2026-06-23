---
title: "Using NEAR AI Cloud With Kilo Code"
description: "Connect NEAR AI Cloud TEE inference to Kilo Code with your NEARAI_API_KEY."
sidebar_label: NEAR AI Cloud
---

# Using NEAR AI Cloud With Kilo Code

Kilo Code supports NEAR AI Cloud as a native OpenAI-compatible provider. NEAR AI Cloud provides TEE-backed private inference for supported models and exposes a public model catalog that Kilo uses to keep the available model list current.

**Website:** [https://cloud.near.ai](https://cloud.near.ai)

## Getting an API Key

1. Sign in to NEAR AI Cloud.
2. Create an API key from your account.
3. Copy the key immediately and store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

Use the **OpenAI Compatible** provider if the legacy provider list does not include NEAR AI Cloud.

- **Base URL:** `https://cloud-api.near.ai/v1`
- **API key:** your NEAR AI Cloud API key
- **Model ID:** use a model ID from the NEAR AI Cloud catalog, such as `zai-org/GLM-5.1-FP8`

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon), go to the **Providers** tab, choose **NEAR AI Cloud**, and enter your API key.

The extension stores your key locally through the Kilo backend auth store. You can also use the environment variable shown in the **CLI** tab.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable:

```bash
export NEARAI_API_KEY="your-api-key"
```

Kilo uses `https://cloud-api.near.ai/v1` by default. To override the endpoint, set:

```bash
export NEARAI_BASE_URL="https://cloud-api.near.ai/v1"
```

Then select a NEAR AI Cloud model from the model picker, or set a default model in `kilo.json`:

```jsonc
{
  "model": "nearai/zai-org/GLM-5.1-FP8"
}
```

You can also configure the provider explicitly:

```jsonc
{
  "provider": {
    "nearai": {
      "env": ["NEARAI_API_KEY"],
      "options": {
        "baseURL": "https://cloud-api.near.ai/v1"
      }
    }
  }
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Native provider:** Kilo uses the OpenAI-compatible NEAR AI Cloud endpoint.
- **Model catalog:** Kilo fetches models from NEAR AI Cloud's public model list and filters to chat-capable text models.
- **TEE inference:** Some NEAR AI Cloud models are verifiable and support TEE attestation. Check the NEAR AI Cloud catalog for per-model attestation support.
- **Compatibility:** Kilo avoids sending OpenAI-only reasoning controls to NEAR AI Cloud.

## Troubleshooting

- **Invalid API key:** Verify `NEARAI_API_KEY` is set in the same environment that launches Kilo, or reconnect the provider in Settings.
- **Model not available:** Refresh providers or pick a current model from the model picker.
- **Custom endpoint issues:** Confirm `NEARAI_BASE_URL` is the full versioned base URL of your catalog (for example, `https://cloud-api.near.ai/v1`). Kilo appends `/model/list` to it; the URL should not end with a trailing slash.
