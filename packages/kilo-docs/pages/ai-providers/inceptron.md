---
title: "Using Inceptron with Kilo Code"
description: "Connect Kilo Code directly to Inceptron with your own Inceptron API key."
sidebar_label: Inceptron
---

# Using Inceptron with Kilo Code

Inceptron provides an OpenAI-compatible inference API for production coding and agent workloads.

Kilo Code connects directly to Inceptron with your own `INCEPTRON_API_KEY`.

**Website:** [https://inceptron.io](https://inceptron.io)

**Docs:** [https://docs.inceptron.io](https://docs.inceptron.io)

## Getting an API Key

1. **Sign up, sign in:** Go to the [Inceptron console](https://console.inceptron.io).
2. **Create an API key:** Open the user account page (menu at the top right) and create a new key.
3. **Copy the key:** Copy the API key immediately and store it securely.

## Supported Models

Kilo Code loads Inceptron's model list from [models.dev](https://models.dev/?search=inceptron).

Refer to the [Inceptron model catalogue](https://console.inceptron.io/models) (requires login) for more information about the models.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code settings:** Open Settings ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select provider:** Choose "Inceptron" from the "API Provider" dropdown.
3. **Enter API key:** Paste your Inceptron API key into the "Inceptron API Key" field.
4. **Select model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** ({% codicon name="gear" /%}) and go to the **Providers** tab to add an Inceptron entry and enter your API key. The extension stores this in your `kilo.json` config file.

Alternatively, set `INCEPTRON_API_KEY` in the environment before starting VS Code:

```bash
export INCEPTRON_API_KEY="your-api-key"
code
```

Then select an Inceptron model from the Kilo Code model picker.

{% /tab %}
{% tab label="CLI" %}

Set `INCEPTRON_API_KEY` before starting Kilo Code:

```bash
export INCEPTRON_API_KEY="your-api-key"
kilo
```

Kilo Code loads Inceptron from [models.dev](https://models.dev/?search=inceptron) and enables it automatically when the environment variable is present. No provider entry is required in `kilo.json` for the standard Inceptron endpoint.

Select an Inceptron model from the CLI model picker, or set a default model in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "model": "inceptron/moonshotai/Kimi-K2.6",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **OpenAI-Compatible API:** Inceptron works through Kilo Code's OpenAI-compatible provider integration.
- **Direct base URL:** The direct provider endpoint defaults to `https://api.inceptron.io/v1`; only override `options.baseURL` if you need a custom endpoint.
- **Docs Feedback:** Report documentation issues at [Kilo-Org/kilocode issues](https://github.com/Kilo-Org/kilocode/issues/new?title=Documentation%20Issue:%20/docs/ai-providers/inceptron).
