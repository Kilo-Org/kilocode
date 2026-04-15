---
sidebar_label: HPC-AI
---

# Using HPC-AI With Kilo Code

HPC-AI provides OpenAI-compatible inference endpoints for models from MiniMax, Moonshot AI, and Z.AI.

**Base URL:** `https://api.hpc-ai.com/inference/v1`

## Supported Models

- `minimax/minimax-m2.5`
- `moonshotai/kimi-k2.5`
- `zai-org/glm-5.1`

Use the `hpc-ai/` provider prefix when selecting one of these models in Kilo Code:

- `hpc-ai/minimax/minimax-m2.5`
- `hpc-ai/moonshotai/kimi-k2.5`
- `hpc-ai/zai-org/glm-5.1`

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab. Add **HPC-AI**, then paste your HPC-AI API key.

The extension stores the API key in Kilo Code's auth store and uses the bundled HPC-AI provider configuration.

{% /tab %}
{% tab label="CLI" %}

Set your API key as an environment variable:

```bash
export HPC_AI_API_KEY="your-api-key"
```

Then set your default model using the `provider-id/model-id` format:

```jsonc
{
  "model": "hpc-ai/minimax/minimax-m2.5",
}
```

You can also override the default HPC-AI Base URL:

```bash
export HPC_AI_BASE_URL="https://api.hpc-ai.com/inference/v1"
```

{% /tab %}
{% /tabs %}

## Notes

- HPC-AI uses the OpenAI-compatible API protocol.
- `HPC_AI_API_KEY` is required for authentication.
- `HPC_AI_BASE_URL` is optional. Leave it unset to use the bundled Base URL.
