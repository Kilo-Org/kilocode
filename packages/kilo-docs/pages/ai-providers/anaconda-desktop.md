---
title: "Using Anaconda Desktop with Kilo Code | Local Models"
description: "Connect Kilo Code to a local Anaconda Desktop text-generation model server from the TUI or VS Code."
sidebar_label: Anaconda Desktop
---

# Using Anaconda Desktop With Kilo Code

Kilo Code can discover the text-generation model served by [Anaconda Desktop](https://www.anaconda.com/products/desktop) and connect to its local OpenAI-compatible endpoint. Kilo imports the server connection for you, so you do not need to copy an API key or configure a base URL manually.

**Official documentation:** [Anaconda Desktop](https://www.anaconda.com/docs/tools/anaconda-desktop/key-features)

## Supported Platforms

Anaconda Desktop and Kilo must run on the same supported computer.

| Operating system | Supported installation |
|---|---|
| Windows | Windows 11, x86-64 |
| macOS | macOS 13 or later, Apple Silicon |
| Linux | Debian or Ubuntu, x86-64 or ARM64 |

Remote backends, remote-only model endpoints, and non-interactive or headless setup are not supported. Complete setup in the Kilo TUI or VS Code on the computer running Anaconda Desktop.

## Set Up Anaconda Desktop

1. Download and install Anaconda Desktop from the [official product page](https://www.anaconda.com/products/desktop). See Anaconda's [installation guide](https://www.anaconda.com/docs/tools/anaconda-desktop/install-desktop) for platform-specific steps.
2. Open Anaconda Desktop and sign in with your Anaconda account or your organization's assigned credentials.
3. Select **Model Catalog** and filter for a **Text Generation** model. Prefer a model tagged **Tool Calling** for full Kilo agent functionality.
4. Select a quantization that fits your computer, then click **Download**. Anaconda's [model catalog guide](https://www.anaconda.com/docs/tools/anaconda-desktop/model-catalog) explains model types, hardware requirements, and quantization choices.
5. Select **Model Servers**, choose the downloaded model and file, and start its server. Enable tool calling when the selected model and server configuration support it.

{% callout type="note" %}
Kilo only discovers Desktop state and connects to an existing server. Downloading or deleting models and creating, switching, starting, stopping, or deleting servers must be done in Anaconda Desktop. See Anaconda's [model server guide](https://www.anaconda.com/docs/tools/anaconda-desktop/servers).
{% /callout %}

## Connect Kilo Code

{% tabs %}
{% tab label="TUI" %}

1. Run `/connect` in the Kilo TUI.
2. Select **Anaconda Desktop**.
3. Follow the setup dialog. Kilo can open Anaconda Desktop; after making changes there, return and choose **Check again**.
4. When the model server is ready, choose **Connect** to import its connection and make the served model available in the model picker.

To refresh an existing connection, run `/connect`, select **Anaconda Desktop**, and choose **connect / refresh now** after changing the model, server address or port, or server API key in Desktop. Kilo re-discovers the active server and replaces its stored model and connection information.

{% /tab %}
{% tab label="VS Code" %}

1. Open Kilo Code **Settings** using the gear icon and select **Providers**.
2. Add **Anaconda Desktop**. No manual API-key field is shown.
3. Follow the setup dialog. Kilo can open Anaconda Desktop; after making changes there, return and select **Check again**.
4. When the model server is ready, select **Connect** to import its connection and refresh the model picker.

For an existing connection, open **Settings**, select **Providers**, and select **Manage / Refresh** for Anaconda Desktop after changing the model, server address or port, or server API key in Desktop.

{% /tab %}
{% /tabs %}

## Tool Calling

When Desktop reports that the model server supports tool calling, Kilo allows you to connect without an additional warning. Tool calling lets the model use Kilo's tools to inspect files, edit code, and run commands.

{% callout type="warning" %}
If tool support is unavailable or cannot be detected, Kilo shows a warning and requires confirmation before connecting. You can still use the model for text generation, but normal coding-agent actions are limited and may fail. For the best experience, choose a **Text Generation** model tagged **Tool Calling** and enable the server's tool-call support when available.
{% /callout %}

## How Keys Are Handled

Anaconda Desktop uses two separate credentials:

- **Desktop management key** - Allows local discovery of Desktop models and servers. Kilo reads it from Desktop's configuration only when needed and never copies it into Kilo storage.
- **Inference server key** - Authenticates chat-completion requests to the running model server. Kilo imports this key into its normal provider authentication storage together with the local endpoint and model details.

Kilo never asks you to paste either key. If the inference server key or endpoint changes, use **Refresh** to import the current values.

## Disconnect

In VS Code, open **Settings** > **Providers** and select **Disconnect** for Anaconda Desktop. In a terminal, run `kilo auth logout` and select Anaconda Desktop. Disconnecting removes only Kilo's stored provider authentication and connection metadata. It does not stop Anaconda Desktop, stop the model server, or delete the downloaded model.

Use Anaconda Desktop itself to stop or change the server.

## Troubleshooting

- **Desktop is not detected:** Install it from the [official product page](https://www.anaconda.com/products/desktop), or use **Open Anaconda Desktop** if it is installed but not running.
- **Sign-in is required:** Open Desktop, complete sign-in, and leave the Kilo setup dialog open so it can detect the change.
- **No model is available:** Download a model whose type is **Text Generation**, not an embedding-only model.
- **No server is available:** Start the downloaded model from **Model Servers** in Desktop.
- **The server changed:** Use **Refresh** in Kilo to replace the stored model, endpoint, and inference key.
- **The server is unhealthy:** Check the server status and logs in Desktop, then restart it there before refreshing Kilo.
