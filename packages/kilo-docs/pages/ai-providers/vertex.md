---
title: "Using GCP Vertex AI with Kilo Code"
description: "Connect Google Cloud Vertex AI to Kilo Code to use Claude, Gemini, and other models through your GCP account."
sidebar_label: GCP Vertex AI
---

# Using GCP Vertex AI With Kilo Code

Kilo Code supports accessing models through Google Cloud Platform's Vertex AI, a managed machine learning platform that provides access to various foundation models, including Anthropic's Claude family.

**Website:** [https://cloud.google.com/vertex-ai](https://cloud.google.com/vertex-ai)

## Prerequisites

- **Google Cloud Account:** You need an active Google Cloud Platform (GCP) account.
- **Project:** You need a GCP project with the Vertex AI API enabled.
- **Model Access:** You must request and be granted access to the specific Claude models on Vertex AI you want to use. See the [Google Cloud documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin) for instructions.
- **Service Account Key:** To connect the VS Code extension, generate a JSON key for a service account that can access Vertex AI. See the [Google Cloud documentation on creating service account keys](https://cloud.google.com/iam/docs/creating-managing-service-account-keys).
- **Application Default Credentials (CLI option):** To use ADC with the CLI, [install the Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth application-default login`.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** and select **Providers**.
2. Find **Google Vertex AI** and select **Connect**.
3. Paste the complete service account JSON into **Service-account JSON**.
4. Enter a **Google Cloud project ID** only if you want to override the `project_id` in the JSON.
5. Enter the **Vertex AI location**, such as `us-central1` or `global`.
6. Select **Submit**.

The extension stores the service account JSON in Kilo's credential store, not in `kilo.json`. The JSON is visible while you edit it so you can verify the value before connecting.

{% callout type="warning" %}
Treat service account JSON like a password. Do not share it or commit it to source control.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

The following CLI setup uses Google Application Default Credentials (ADC). Authenticate with the Google Cloud CLI:

```bash
gcloud auth application-default login
```

Set your project and location as environment variables:

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_CLOUD_LOCATION="us-east5"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "google-vertex": {},
  },
}
```

Then set your default model:

```jsonc
{
  "model": "google-vertex/claude-sonnet-4@20250514",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Permissions:** Ensure your Google Cloud account has the necessary permissions to access Vertex AI and the specific models you want to use.
- **Prompt caching:** Claude models served through Vertex AI support Kilo prompt caching. Kilo applies Anthropic cache controls and tracks cache write/read tokens when Vertex reports them. Native Vertex Gemini models use Google's implicit server-side caching; no extra Kilo configuration is required, and Gemini may not report cache write tokens.
- **Pricing:** Refer to the [Vertex AI pricing](https://cloud.google.com/vertex-ai/pricing) page for details.
