---
sidebar_label: Ollama
---

# Using Ollama With Kilo Code

Kilo Code supports running models locally using Ollama. This provides privacy, offline access, and potentially lower costs, but requires more setup and a powerful computer.

**Website:** [https://ollama.com/](https://ollama.com/)

<img src="/docs/img/providers/ollama-devstral-snake.png" alt="Vibe coding a Snake game using devstral" width="500" />
*Vibe coding a Snake game using devstral*

## Managing Expectations

Local LLMs are much smaller than premium cloud-hosted LLMs such as Claude and Gemini and the results will be much less impressive.
They are much more likely to get stuck in loops, fail to use tools properly or produce syntax errors in code.
More trial and error will be required to find the right prompt.
Local LLMs are usually also not very fast.
Using simple prompts, keeping conversations short and disabling MCP tools can result in a speed-up.

## Hardware Requirements

You will need a large amount of RAM (32GB or more) and a powerful CPU (e.g. Ryzen 9000 series) to run the models listed below.
GPUs can run LLMs much faster, but a large amount of VRAM is required (24GB, if not more), which is not very common on consumer GPUs.
Smaller models will run on more modest GPUs, but do not provide good results.
MacBooks with a sufficient amount of unified memory can use GPU-acceleration, but do not outperform high-end desktop CPUs in our testing.

## Selecting a Model

Ollama supports many different models.
You can find a list of available models on the [Ollama website](https://ollama.com/library).
Selecting a model that suits your use case, runs on your hardware configuration and achieves the desired speed requires some trial and error.
The following rules and heuristics can be used to find a model:

- Must have at least a 32k context window (this is a requirement for Kilo Code).
- Listed as supporting tools.
- Number of parameters in the 7b to 24b range.
- Prefer popular models.
- Prefer newer models.

### Recommendations for Kilo Code

We tested a few models with the following prompt:

```
Create a simple web page with a button that greets the user when clicked.
```

A model is considered to pass if it produces a working result within a few tries. The models we found to work correctly are:

| Model name       | Completion time |
| ---------------- | --------------- |
| qwen2.5-coder:7b | 1x (baseline)   |
| devstral:24b     | 2x              |
| gemma3:12b       | 4x              |
| qwen3-8b         | 12x             |

Our recommendation is to use **devstral:24b** if your hardware can handle it, because it makes fewer mistakes than qwen2.5-coder:7b.
qwen2.5-coder:7b is worth considering because of its speed, if you can put up with its mistakes.
The table also shows speed can be hard to predict, since the special-purpose devstral:24b outperforms the smaller general-purpose models gemma3:12b and qwen3-8b here.
The gemma3:12b result is remarkable, because it can use tools correctly (at least sometimes), while not being listed as suitable for tool use on the Ollama website.

The result produced by devstral:24b is included below:

```html
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Greet User Button</title>
		<style>
			body {
				font-family: Arial, sans-serif;
				display: flex;
				justify-content: center;
				align-items: center;
				height: 100vh;
				margin: 0;
			}
			button {
				padding: 10px 20px;
				font-size: 16px;
				cursor: pointer;
			}
		</style>
	</head>
	<body>
		<button onclick="greetUser()">Greet Me!</button>

		<script>
			function greetUser() {
				alert("Hello! Welcome to our website.")
			}
		</script>
	</body>
</html>
```

The following models look like reasonable choices, but were found to **not** work properly with Kilo Code in its default configuration:

| Model name     | Fail reason                    |
| -------------- | ------------------------------ |
| deepseek-r1:7b | fails to use tools properly    |
| deepseek-r1:8b | gets stuck in a reasoning loop |

## Preventing prompt truncation

By default Ollama truncates prompts to a very short length.
If you run into this problem, please see this FAQ item to resolve it:
[How can I specify the context window size?](https://github.com/ollama/ollama/blob/4383a3ab7a075eff78b31f7dc84c747e2fcd22b8/docs/faq.md#how-can-i-specify-the-context-window-size)

If you decide to use the `OLLAMA_CONTEXT_LENGTH` environment variable, it needs to be visible to both the IDE and the Ollama server.

## Setting up Ollama

1.  **Download and Install Ollama:** Download the Ollama installer for your operating system from the [Ollama website](https://ollama.com/). Follow the installation instructions and make sure Ollama is running:

    ```bash
    ollama serve
    ```

2.  **Download a Model:** Once you've downloaded a model, you can use Kilo Code offline with that model. To download a model, open your terminal and run:

    ```bash
    ollama pull <model_name>
    ```

    For example:

    ```bash
    ollama pull devstral:24b
    ```

3.  **Configure Kilo Code:**
    - Open the Kilo Code sidebar (<img src="/docs/img/kilo-v1.svg" width="12" /> icon).
    - Click the settings gear icon (<Codicon name="gear" />).
    - Select "ollama" as the API Provider.
    - Enter the Model name.
    - (Optional) You can configure the base URL if you're running Ollama on a different machine. The default is `http://localhost:11434`.

## Further Reading

Refer to the [Ollama documentation](https://ollama.com/docs) for more information on installing, configuring and using Ollama.
