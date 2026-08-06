---
title: "Using Google Gemini with Kilo Code"
description: "Connect Google Gemini models to Kilo Code. Guide to getting an API key from Google AI Studio and configuring Gemini in VS Code and the CLI."
sidebar_label: Google Gemini
---

# Using Google Gemini With Kilo Code

Kilo Code supports Google's Gemini family of models through the Google AI Gemini API.

**Website:** [https://ai.google.dev/](https://ai.google.dev/)

## Getting an API Key

1.  **Go to Google AI Studio:** Navigate to [https://ai.google.dev/](https://ai.google.dev/).
2.  **Sign In:** Sign in with your Google account.
3.  **Create API Key:** Click on "Create API key" in the left-hand menu.
4.  **Copy API Key:** Copy the generated API key.

## API key requirements

Google AI Studio creates auth keys by default. Kilo sends these keys in the `x-goog-api-key` header required by the Gemini API. An auth key is not an OAuth access token, so you do not need to configure OAuth.

Google began rejecting unrestricted Standard keys on June 19, 2026. If Gemini returns `Request had invalid authentication credentials`, open the key in [Google AI Studio](https://aistudio.google.com/api-keys) and check its type and status. Replace a Standard key with a new auth key. If the rejected key is already an auth key, check its Gemini API access or create a replacement before updating Kilo.

You can temporarily keep a Standard key working by restricting it to the Gemini API (`generativelanguage.googleapis.com`), but Google will reject all Standard keys in September 2026. See [Google's Gemini API key documentation](https://ai.google.dev/gemini-api/docs/api-key) for restriction and migration steps.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Google Gemini and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "google": {
      "env": ["GOOGLE_GENERATIVE_AI_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "google/gemini-2.5-pro",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Pricing:** Gemini API usage is priced based on input and output tokens. Refer to the [Gemini pricing page](https://ai.google.dev/pricing) for detailed information.
- **Codebase Indexing:** The `gemini-embedding-001` model is specifically supported for [codebase indexing](/docs/customize/context/codebase-indexing), providing high-quality embeddings for semantic code search.
