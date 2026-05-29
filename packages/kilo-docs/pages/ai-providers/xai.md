---
title: "Using xAI Grok with Kilo Code"
description: "Connect xAI's Grok models to Kilo Code. Use a SuperGrok or X Premium subscription via OAuth or a paid API key. Guide to setup in VS Code and the CLI."
sidebar_label: xAI (Grok)
---

# Using xAI (Grok) With Kilo Code

xAI is the company behind Grok, a large language model known for its conversational abilities and large context window. Grok models are designed to provide helpful, informative, and contextually relevant responses.

**Website:** [https://x.ai/](https://x.ai/)

Kilo Code supports two ways to connect xAI:

- **SuperGrok or X Premium subscription (OAuth):** If you subscribe to SuperGrok or X Premium, you can sign in with OAuth — no separate API key or pay-as-you-go charges required.
- **API key:** For pay-as-you-go access via the xAI API.

---

## Option 1: SuperGrok or X Premium Subscription (OAuth)

If you have an active [SuperGrok or X Premium subscription](https://x.ai/grok), you can authenticate with xAI using OAuth and use Grok models directly without needing a separate API key.

### Why use SuperGrok or X Premium?

- **No API billing:** Usage counts against your subscription, not a pay-per-token API account.
- **OAuth login — no API keys:** Sign in through your browser and Kilo Code handles token management automatically.
- **Automatic token refresh:** Kilo Code refreshes your access token in the background so long-running sessions stay authenticated.

{% callout type="note" %}
SuperGrok and X Premium subscription access works with Kilo Code's core functionality (VS Code extension and CLI). For cloud features such as Cloud Agents or KiloClaw, use the [Kilo Gateway](/docs/gateway) — the Gateway supports xAI via [BYOK](/docs/getting-started/byok) with an API key (OAuth and subscription-based access are not supported through the Gateway).
{% /callout %}

### Setup with SuperGrok / X Premium

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. Open Kilo Code settings (click the gear icon {% codicon name="gear" /%} in the Kilo Code panel).
2. In **API Provider**, select **xAI**.
3. Click **Sign in with xAI (SuperGrok / X Premium)**.
4. Complete the authorization flow in your browser.
5. Back in Kilo Code settings, select your desired Grok model.
6. Save.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab. Click **Show more providers**, then search for or select **xAI**. Choose the **xAI Grok OAuth (SuperGrok / X Premium)** sign-in option and complete the OAuth flow in your browser.

For headless or remote environments (VPS, SSH, Docker, WSL) where a browser redirect to `127.0.0.1` is not reachable, choose **xAI Grok OAuth (Headless / Remote / VPS)** instead. You will be shown a short code to enter at a URL you open on any device with a browser.

{% /tab %}
{% tab label="CLI" %}

Run the auth command and follow the xAI sign-in flow:

```bash
kilo auth login --provider xai
```

Kilo Code offers three methods at the prompt:

- **xAI Grok OAuth (SuperGrok / X Premium)** — opens `https://auth.x.ai` in your browser for a standard PKCE OAuth flow. Best for local desktop environments.
- **xAI Grok OAuth (Headless / Remote / VPS)** — uses the RFC 8628 device-code flow. The CLI displays a short code and a URL; open the URL on any device with a browser, enter the code, and the CLI completes the login. Use this when running on a VPS, behind SSH, inside Docker, WSL, or CI where `127.0.0.1:56121` is not accessible from your browser.
- **Manually enter API Key** — fall back to a standard API key if you prefer.

Then set your default model:

```jsonc
{
  "model": "xai/grok-3",
}
```

{% /tab %}
{% /tabs %}

### Tips for SuperGrok and X Premium

- **Subscription required:** You need an active SuperGrok or X Premium subscription. This option will not work with a free xAI account.
- **Sign out:** To disconnect in VS Code, use the "Disconnect" button in the provider settings. In the CLI, run `kilo auth logout` and choose xAI.
- **Port 56121:** The browser OAuth flow (PKCE) starts a short-lived local server on `127.0.0.1:56121` to receive the OAuth callback. If another application is already using that port, use the headless device-code method instead.
- **Token rotation:** xAI rotates refresh tokens on each use. Kilo Code persists the latest tokens automatically. If you run Kilo Code from multiple processes simultaneously, the first refresh can invalidate the other process's token — re-run `kilo auth login --provider xai` to restore the session.

---

## Option 2: API Key

If you prefer pay-as-you-go access or do not have a SuperGrok or X Premium subscription, you can use an xAI API key.

### Getting an API Key

1. **Sign Up/Sign In:** Go to the [xAI Console](https://console.x.ai/). Create an account or sign in.
2. **Navigate to API Keys:** Go to the API keys section in your dashboard.
3. **Create a Key:** Click to create a new API key. Give your key a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

### Configuration with API Key

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "xAI" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your xAI API key into the "xAI API Key" field.
4.  **Select Model:** Choose your desired Grok model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab. Click **Show more providers**, then search for or select **xAI** and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export XAI_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "xai": {
      "env": ["XAI_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "xai/grok-3",
}
```

{% /tab %}
{% /tabs %}

---

## Reasoning Capabilities

Some models feature specialized reasoning capabilities, allowing them to "think before responding" - particularly useful for complex problem-solving tasks.

### Controlling Reasoning Effort

When using reasoning-enabled models, you can control how hard the model thinks with the `reasoning_effort` parameter:

- `low`: Minimal thinking time, using fewer tokens for quick responses
- `high`: Maximum thinking time, leveraging more tokens for complex problems

Choose `low` for simple queries that should complete quickly, and `high` for harder problems where response latency is less important.

### Key Features

- **Step-by-Step Problem Solving**: The model thinks through problems methodically before delivering an answer
- **Math & Quantitative Strength**: Excels at numerical challenges and logic puzzles
- **Reasoning Trace Access**: The model's thinking process is available via the `reasoning_content` field in the response completion object

## Tips and Notes

- **Context Window:** Most Grok models feature large context windows (up to 131K tokens), allowing you to include substantial amounts of code and context in your prompts.
- **Vision Capabilities:** Select vision-enabled models (`grok-2-vision-latest`, `grok-2-vision`, etc.) when you need to process or analyze images.
- **Pricing:** API key pricing varies by model, with input costs ranging from $0.3 to $5.0 per million tokens and output costs from $0.5 to $25.0 per million tokens. Refer to the xAI documentation for the most current pricing information.
- **Performance Tradeoffs:** "Fast" variants typically offer quicker response times but may have higher costs, while "mini" variants are more economical but may have reduced capabilities.
