---
title: "Local Models"
description: "Run AI models locally with Kilo Code"
---

# Using Local Models

Kilo Code supports running language models locally on your own machine using [Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/), and [Atomic Chat](https://atomic.chat/). This offers several advantages:

- **Privacy:** Your code and data never leave your computer.
- **Offline Access:** You can use Kilo Code even without an internet connection.
- **Cost Savings:** Avoid API usage fees associated with cloud-based models.
- **Customization:** Experiment with different models and configurations.

**However, using local models also has some drawbacks:**

- **Resource Requirements:** Local models can be resource-intensive, requiring a powerful computer with a good CPU and, ideally, a dedicated GPU.
- **Setup Complexity:** Setting up local models can be more complex than using cloud-based APIs.
- **Model Performance:** The performance of local models can vary significantly. While some are excellent, they may not always match the capabilities of the largest, most advanced cloud models.
- **Limited Features**: Local models (and many online models) often do not support advanced features such as prompt caching, computer use, and others.

## Supported Local Model Providers

Kilo Code supports several local model providers:

1.  **Ollama:** A popular open-source tool for running large language models locally. It supports a wide range of models.
2.  **LM Studio:** A user-friendly desktop application that simplifies downloading and running local models, with a local server that emulates the OpenAI API.
3.  **[Atomic Chat](https://atomic.chat/):** Open-source local AI with TurboQuant-optimized inference, a built-in chat UI, and an OpenAI-compatible API on port **1337**. Kilo Code can discover loaded models when you opt in (`provider.atomic-chat`, `atomicChat.autoDetect`, or an `atomic-chat/...` model).

## Setting Up Local Models

For detailed setup instructions, see:

- [Setting up Ollama](/docs/ai-providers/ollama)
- [Setting up LM Studio](/docs/ai-providers/lmstudio)
- [Setting up Atomic Chat](/docs/ai-providers/atomic-chat)

## Troubleshooting

- **"No connection could be made because the target machine actively refused it":** This usually means that Atomic Chat, Ollama, or LM Studio isn't running, or is on a different port than Kilo Code expects (Atomic Chat: `http://127.0.0.1:1337/v1`, LM Studio: `http://127.0.0.1:1234/v1`, Ollama: `http://127.0.0.1:11434`). Double-check the Base URL setting.

- **Slow Response Times:** Local models can be slower than cloud-based models, especially on less powerful hardware. If performance is an issue, try using a smaller model.

- **Model Not Found:** Ensure you have typed in the name of the model correctly. If you're using Ollama, use the same name that you provide in the `ollama run` command.
