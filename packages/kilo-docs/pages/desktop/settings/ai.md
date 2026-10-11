---
title: "AI settings"
description: "Configure agent behavior, AI providers, and the local model server in Kilo Desktop."
---

# AI settings

Open settings from the gear at the bottom of the sidebar, and use the search box at the top to filter them. The **AI** settings cover agent behavior, AI providers, and the local model server.

## Agent behavior

The **Agent Behavior** section is where you review and install the [agents](/docs/code-with-ai/agents/using-agents), [skills](/docs/customize/skills), and [MCP servers](/docs/automate/mcp/what-is-mcp) Kilo can use.

Installed items are grouped by type, and you can search them or filter by **Agents**, **MCPs**, or **Skills**. You can also filter by {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Workspace**. Each item shows the workspaces it applies to (such as **All Workspaces**) and its author. Expand an item to see its details and to remove it; an MCP also shows whether it's **Connected**. **Refresh** re-checks for changes.

Select **+ Add** to open the **Kilo Marketplace**, where you can browse specialized agents, skills, and MCPs by category and install them. See [Marketplace](/docs/customize/marketplace) for the full catalog and how installing works.

## AI providers

The **AI Providers** section lists your enabled AI providers, and **Add AI Provider** (top-right) connects a new one.

The **Kilo Gateway** is the default path to models. When you're signed in it shows your account email and available balance; when you're signed out, use **Sign In**. Manage your account from the [Account](/docs/desktop/settings/general#account) section.

Other providers appear below the gateway:

- **Local Model Server** — models running on your machine; **Manage** opens the [Local model server](#local-model-server) settings.
- **Providers you add** — anything you connect with an API key, each with edit and delete actions.
- **System credentials** — some providers (such as **Amazon Bedrock**) connect automatically using credentials already on your machine rather than a stored API key. Expand the card to see the environment variables that were detected (for example, `AWS_PROFILE`). These are managed outside the app, so they can't be edited or removed here.

To add a provider, select **Add AI Provider** and either:

- **Pick a popular provider**. Available providers are **Anthropic**, **DeepSeek**, **OpenAI**, **Google**, **OpenRouter**, and **Vercel AI Gateway**. Paste its **API key** to connect to the provider.
- **Add a Custom AI Provider** for any OpenAI- or Anthropic-compatible endpoint. To enable a custom AI provider, you'll need:
    - The **Provider name**
    - An **API format** (OpenAI Compatible, OpenAI Responses, or Anthropic Messages)
    - The **Base URL**
    - An optional **API key** (only needed when the endpoint requires authentication).
    - The **Model ID(s)** the endpoint exposes. Flag whether each model supports **Reasoning** or **Images**.

    **Advanced settings** adds custom request headers — use `{env:MY_API_TOKEN}` in a header value to pull a secret from the environment.

Hosted models run through the gateway, so signing in is required to use them.

For details on the gateway itself, see [Models & Providers](/docs/gateway/models-and-providers).

## Local model server

The **Local Model Server** section runs models on your own machine and exposes them to Kilo through an OpenAI-compatible endpoint. The toggle at the top starts and stops the server; the status beside it reads **Idle**, **Starting…**, or **Running**.

**System Monitor** shows live **CPU**, **RAM**, and **GPU** usage so you can gauge how much headroom a model has.

**Connect** holds the details an external client needs once the server is running: a copyable **Server Address** (for example `http://127.0.0.1:51009/v1`) and a masked **API Key**. Both read *Unavailable* until the server starts. {% svgIcon src="/docs/img/desktop/cable.svg" /%} **Request info** opens example request URLs and `curl` commands for the endpoints.

**Models** lists the models you've added and lets you configure each one. Select **Add model → Import GGUF** to add a model from a `.gguf` file on disk. Each model shows whether it's **Loaded** or **Not loaded**, and its {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} menu can remove it from the server or reveal the file on disk.

### Model settings

Select a model to open its settings, grouped into **General**, **Sampling**, and **Advanced** tabs. Every control has an automatic default so you only change what you need. After making a change, you can select the {% svgIcon src="/docs/img/desktop/rotate-ccw.svg" /%} reset button next to a control to return it to the default. Changes save automatically.

**General**

- **Coding tools and instructions** — off by default for faster local inference. Turn it on to give the model the full context and tools that Kilo Code uses by default. This is not advised for the smallest of models and should only be used with models that support tool-calling.
- **Context length** — the maximum number of tokens the model holds at once, including the conversation so far and the response being generated. Larger values use more memory and can slow generation. Ranges from **256** to **1,048,576** tokens.
- **Temperature** — how random the output is. Lower values are more predictable and focused; higher values are more varied and creative. Ranges from **0** to **2**.
- **Max tokens** — the maximum number of tokens the model generates in a single response. Unlimited by default; ranges from **1** to **1,048,576**.

**Sampling**

- **Top P** — limits sampling to the most likely tokens whose probabilities add up to this value (nucleus sampling). Lower values keep output focused; higher values allow more variety. Ranges from **0** to **1**.
- **Top K** — limits sampling to this many of the most likely tokens; **0** removes the limit. Ranges from **0** to **100**.
- **Min P** — drops tokens whose probability is below this fraction of the most likely token's probability. Ranges from **0** to **1**.
- **Repetition penalty** — discourages repeating the same sequences of tokens. Higher values penalize repetition more; **1** disables it. Ranges from **0** to **2**.
- **Presence penalty** — nudges the model toward tokens it hasn't used yet, encouraging new topics; **0** disables it. Ranges from **0** to **2**.

**Advanced**

- **Extra Arguments** — pass `llama.cpp` flags exactly as you would on the command line (for example `--n-gpu-layers 99`). Matching flags override the settings in the other tabs; app-managed flags are refused.

### Runtime settings

**Runtime** controls how the server itself runs:

- **Server port** — leave blank to pick an available port automatically or enter a specific port.
- **Models kept loaded** — keep **One model** loaded to save memory, or **All models** you use.
- **Serve on local network** — let trusted devices on your Wi-Fi or LAN connect.

See [Local inference](/docs/desktop/features/local-inference) for how local models appear in chats.
