---
title: "Using Nodecode with Kilo Code"
description: "Connect Kilo Code to Nodecode's OpenAI-compatible API and use Cyber v1, an abliterated model for security work."
sidebar_label: Nodecode
---

# Using Nodecode With Kilo Code

[Nodecode](https://nodecode.ai) is an inference API run by Foresight Labs in the Netherlands. It serves Cyber v1 (`nodecode-cyber-v1`), DeepSeek V4.1 Flash with its refusal direction removed (abliterated), for security work such as penetration testing, red teaming and exploit development. It runs on machines in the EU with zero data retention. Kilo Code uses the `nodecode` provider ID and reads your API key from `NODECODE_API_KEY`.

## Before you begin

1. Create an account at [nodecode.ai](https://nodecode.ai) and top up a balance. Calls are paid per token from that balance.
2. Create an API key at [nodecode.ai/account/keys](https://nodecode.ai/account/keys). Keys start with `sk-nc-` and are shown once.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **Nodecode**. If it is not visible, click **Show more providers**.
3. Enter your Nodecode API key.
4. Select **Cyber v1** as the model.

If `NODECODE_API_KEY` is set in the environment VS Code starts from, Nodecode is listed under **Connected providers** without entering the key.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store (same credential store as VS Code).

1. In the TUI, run `/connect` and choose **Nodecode**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider nodecode
```

Then pick Cyber v1 from the model picker, or set it as the default model:

```jsonc
{
  "model": "nodecode/nodecode-cyber-v1",
}
```

**Environment variable (optional):** Kilo Code also picks up the key from the environment, so a one-off run needs no stored credential:

```bash
export NODECODE_API_KEY="your-api-key"
kilo run -m nodecode/nodecode-cyber-v1 "List the services to check first on a host with 22/tcp and 8080/tcp open"
```

{% /tab %}
{% /tabs %}

## Model

| Model ID | Context window | Max output |
|---|---|---|
| `nodecode-cyber-v1` | 1,048,576 tokens | 131,072 tokens |

Cyber v1 is a reasoning model: it thinks before it answers, and the thinking counts toward the output tokens. Prices per token are on the [Nodecode pricing page](https://nodecode.ai/docs/pricing).

## API compatibility

Kilo Code connects to Nodecode through the OpenAI-compatible Chat Completions API at `https://api.nodecode.ai/v1`. Nodecode also answers the OpenAI Responses API and the Anthropic Messages API at the same host, but the provider on this page uses Kilo Code's OpenAI-compatible chat path.

For cURL, Claude Code and Codex CLI examples, see the [Cyber v1 API quickstart](https://nodecode.ai/docs/cyber).

## Troubleshooting

- **Invalid API key:** Create a new key at [nodecode.ai/account/keys](https://nodecode.ai/account/keys), then reconnect with `/connect` / `kilo auth login --provider nodecode`, or update `NODECODE_API_KEY`.
- **`402` with `insufficient_balance`:** The balance is empty. Top up at [nodecode.ai/account/top-up](https://nodecode.ai/account/top-up); the next request goes through without other changes.
- **Empty reply:** The model spent its output tokens on reasoning. Do not set a low output token limit for this model.
- **Provider not visible:** Refresh Kilo Code's provider catalog, then check **Show more providers**.

{% callout type="note" %}
This documentation was contributed by the Nodecode team.
{% /callout %}
