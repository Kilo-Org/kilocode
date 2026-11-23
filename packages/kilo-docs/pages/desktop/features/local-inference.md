---
title: "Local inference"
description: "Run models on your own machine with the local model server in Kilo Desktop."
---

# Local inference

Run models on your own machine through a managed local model server, so you can work with a model without sending your prompts to a hosted provider.

{% callout type="info" %}
The local model server doesn't require a Kilo account. Downloading models from the catalog requires an [Anaconda account](/docs/desktop/settings/general#account).
{% /callout %}

## Set up a local model

Turn the server on and add a model from the [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings:

- **Download one from the catalog.** Select **Add model → From catalog** to browse the Anaconda model catalog. Kilo Desktop recommends models that suit your hardware, estimates how well each one runs, and downloads the file for you.
- **Import a GGUF file.** Select **Add model → Import GGUF** to add a `.gguf` file that's already on your disk.

Eligible models downloaded with Anaconda Desktop may also be imported automatically. The settings cover the full set of server and per-model options.

## Pick it in chat

To use a local model in a chat, open the model picker, then select {% svgIcon src="/docs/img/desktop/server.svg" /%} **Local Model Server**. Selecting it can start the server. Choose an available model; it's prepared before your prompt runs. First use may take time while the runtime is installed and the model is prepared.

For coding tools, enable **Coding tools and instructions** in the model's **General** settings and use a model that supports tool calling. This setting is off by default.

## Connect other apps

The server's **Connect** panel provides an OpenAI-compatible HTTP address and API key. **Serve on local network** is off by default. If you enable it, use a trusted network and protect the key: HTTP is unencrypted, and copied request examples contain the key.

