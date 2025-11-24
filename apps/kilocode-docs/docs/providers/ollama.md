---
sidebar_label: Ollama
---

# Using Ollama With Kilo Code

Kilo Code supports running models locally using Ollama. This provides privacy, offline access, and potentially lower costs, but requires more setup and a powerful computer.

**Website:** [https://ollama.com/](https://ollama.com/)

<img src="/docs/img/providers/ollama-devstral-snake.png" alt="Vibe coding a Snake game using devstral" width="500" />
*Vibe coding a Snake game using devstral*

## Managing Expectations

The LLMs that can be run locally are generally much smaller than cloud-hosted LLMs such as Claude and GPT and the results will be much less impressive.
They are much more likely to get stuck in loops, fail to use tools properly or produce syntax errors in code.
More trial and error will be required to find the right prompt.
Running LLMs locally is often also not very fast.
Using simple prompts, keeping conversations short and disabling MCP tools can result in a speed-up.

## Hardware Requirements

You will need a GPU with a large amount of VRAM (24GB or more) or a MacBook with a large amount of unified RAM (32GB or more) to run the models discussed below at decent speed.

## Selecting a Model

Ollama supports many different models.
You can find a list of available models on the [Ollama website](https://ollama.com/library).

For the Kilo Code agent the current recommendation is `qwen3-coder:30b`. `qwen3-coder:30b` sometimes fails to call tools correctly (it is much more likely to have this problem than the full `qwen3-coder:480b` model). As a mixture-of-experts model, this could be because it activated the wrong experts. Whenever this happens, try changing your prompt or use the Enhance Prompt button.

An alternative to `qwen3-coder:30b` is `devstral:24b`. For other features of Kilo Code such as Enhance Prompt or Commit Message Generation smaller models may suffice.

## Setting up Ollama

To set up Ollama for use with Kilo Code, follow the instructions below.

### Download and Install Ollama

Download the Ollama installer from the [Ollama website](https://ollama.com/) (or use the package manager for your operating system). Follow the installation instructions, then make sure Ollama is running:

```bash
ollama serve
```

### Download a Model

To download a model, open a second terminal (`ollama serve` needs to be running) and run:

```bash
ollama pull <model_name>
```

For example:

```bash
ollama pull qwen3-coder:30b
```

### Configure the Context Size

By default Ollama truncates prompts to a very short length, [as documented here](https://github.com/ollama/ollama/blob/4383a3ab7a075eff78b31f7dc84c747e2fcd22b8/docs/faq.md#how-can-i-specify-the-context-window-size).

You need to have at least 32k to get decent results, but increasing the context size increases memory usage and may decrease performance, depending on your hardware.

To configure the context window, set "Context Window Size (num_ctx)" in the API Provider settings.

### Configure the Timout

By default, API requests time out after 10 minutes. Local models can be slow, if you hit this timeout you can consider increasing it here: VS Code Extensions panel > Kilo Code gear menu > Settings > API Request Timeout.

### Configure Kilo Code

- Open the Kilo Code sidebar (<img src="/docs/img/kilo-v1.svg" width="12" /> icon).
- Click the Settings gear icon (<Codicon name="gear" />).
- Select "Ollama" as the API Provider.
- Select the model configured in the previous step.
- (Optional) You can configure the base URL if you're running Ollama on a different machine. The default is `http://localhost:11434`.

## Further Reading

Refer to the [Ollama documentation](https://ollama.com/docs) for more information on installing, configuring and using Ollama.
