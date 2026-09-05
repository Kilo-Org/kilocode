---
title: "Using SaladCloud AI Gateway with Kilo Code"
description: "Connect SaladCloud AI Gateway to Kilo Code using the built-in provider for Qwen3.6 35B-A3B."
sidebar_label: SaladCloud AI Gateway
---

# Using SaladCloud AI Gateway with Kilo Code

[SaladCloud AI Gateway](https://salad.com/ai-gateway) provides per-token access to Qwen3.6 35B-A3B through an
OpenAI-compatible API.

Kilo Code discovers SaladCloud AI Gateway through [models.dev](https://models.dev) and loads the SaladCloud AI SDK
provider automatically. You do not need to configure a custom provider, base URL, or model metadata.

## Get an API key

1. Sign in to the [SaladCloud portal](https://portal.salad.com).
2. Open the [API keys page](https://portal.salad.com/api-key).
3. Create or copy an API key and store it securely.

## Configure Kilo Code

SaladCloud AI Gateway is a built-in provider in Kilo Code.

{% tabs %}
{% tab label="VS Code" %}

1. Open **Settings** (gear icon) in the Kilo Code extension.
2. Go to the **Providers** tab.
3. Search for and select **SaladCloud AI Gateway**. If it is not visible, click **Show more providers**.
4. Enter your SaladCloud API key.
5. Select **Qwen3.6 35B-A3B** from the model picker.

{% /tab %}
{% tab label="CLI" %}

Run `kilo`, then use `/connect` to select **SaladCloud AI Gateway** and enter your API key:

```bash
kilo
# then, inside Kilo Code, run:
/connect
```

You can instead provide the key through an environment variable. Export the key before refreshing the models catalog:

```bash
export SALAD_CLOUD_API_KEY="your-api-key"
kilo models salad-cloud --refresh
```

The models command should print:

```text
salad-cloud/qwen3.6-35b-a3b
```

To make this model the default, add it to `~/.config/kilo/kilo.json` or `./kilo.json`:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "model": "salad-cloud/qwen3.6-35b-a3b"
}
```

{% /tab %}
{% /tabs %}

## Test the connection

Run a task with the SaladCloud model:

```bash
kilo run \
  --model salad-cloud/qwen3.6-35b-a3b \
  "Explain distributed inference in five sentences."
```

## Model details

| Model | Context window | Input | Input price | Output price |
|---|---|---|---|---|
| `qwen3.6-35b-a3b` | 262,144 tokens | Text and image | $0.09/M tokens | $0.60/M tokens |

The model supports reasoning and tool calling. See the SaladCloud [model reference](https://docs.salad.com/ai-gateway/reference/models) and [pricing](https://docs.salad.com/ai-gateway/reference/pricing) for current details.

## Troubleshooting

If `kilo models salad-cloud --refresh` reports `Provider not found: salad-cloud`, confirm that
`SALAD_CLOUD_API_KEY` is set in the same terminal before running the command:

```bash
test -n "$SALAD_CLOUD_API_KEY" && echo "API key is set"
```

Kilo Code only makes providers available when their required environment variables or stored credentials are present.

## Tips and notes

- Use `salad-cloud` as the provider ID. The full model ID is `salad-cloud/qwen3.6-35b-a3b`.
- Kilo Code installs `@saladtechnologies-oss/ai-sdk-provider` automatically.
- Do not add `https://ai.salad.cloud/v1` as a custom base URL for this built-in integration.
