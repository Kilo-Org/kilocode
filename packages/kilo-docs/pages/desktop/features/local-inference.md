---
title: "Local inference"
description: "Run models on your own machine with the local model server in Kilo Desktop."
---

# Local inference

Run models on your own machine through a managed local model server, so you can work with a model without sending your prompts to a hosted provider.

{% callout type="info" %}
The local model server requires a [Kilo account](/docs/desktop/settings/ai#ai-providers). Sign in to use it. Downloading models from the catalog also requires an [Anaconda account](/docs/desktop/settings/general#account).
{% /callout %}

## Set up a local model

Sign in, turn the server on, and add a model from the [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings. You can add a model in two ways:

- **Download one from the catalog.** Select **Add model → From catalog** to browse the Anaconda model catalog. Kilo Desktop recommends models that suit your hardware, estimates how well each one runs, and downloads the file for you.
- **Import a GGUF file.** Select **Add model → Import GGUF** to add a `.gguf` file that's already on your disk.

The [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings cover the full set of server and per-model options.

## Pick it in chat

To use a local model in a chat, open the model picker, then select {% svgIcon src="/docs/img/desktop/server.svg" /%} **Local Model Server**. The models you've added appear there. Choose one and use it like any other model. 

