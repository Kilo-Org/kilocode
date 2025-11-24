# Using Local Models

Kilo Code supports running language models locally on your own machine using [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/).  This offers several advantages:

*   **Privacy:** Your code and data never leave your computer.
*   **Offline Access:**  You can use Kilo Code even without an internet connection.
*   **Cost Savings:**  Avoid API usage fees associated with cloud-based models.
*   **Customization:**  Experiment with different models and configurations.

**However, using local models also has some drawbacks:**

*   **Resource Requirements:**  Local models can be resource-intensive, requiring a powerful computer with a good CPU and, ideally, a dedicated GPU.
*   **Setup Complexity:**  Setting up local models can be more complex than using cloud-based APIs.
*   **Model Performance:**  The performance of local models can vary significantly. While some are excellent, they may not always match the capabilities of the largest, most advanced cloud models.
* **Limited Features**: Local models (and many online models) often do not support advanced features such as prompt caching, computer use, and others.

## Supported Local Model Providers

Kilo Code currently supports two main local model providers:

1.  **Ollama:**  A popular open-source tool for running large language models locally.  It supports a wide range of models.
2.  **LM Studio:**  A user-friendly desktop application that simplifies the process of downloading, configuring, and running local models.  It also provides a local server that emulates the OpenAI API.

## Setting Up Local Models

For detailed setup instructions, see:
* [Setting up Ollama](/providers/ollama)
* [Setting up LM Studio](/providers/lmstudio)

Both providers offer similar capabilities but with different user interfaces and workflows. Ollama provides more control through its command-line interface, while LM Studio offers a more user-friendly graphical interface.

## Troubleshooting

*   **"No connection could be made because the target machine actively refused it":**  This usually means that the Ollama or LM Studio server isn't running, or is running on a different port/address than Kilo Code is configured to use.  Double-check the Base URL setting.

*   **Slow Response Times:** Local models can be slower than cloud-based models, especially on less powerful hardware.  If performance is an issue, try using a smaller model.

*   **Model Not Found:** Ensure you have typed in the name of the model correctly. If you're using Ollama, use the same name that you provide in the `ollama run` command.
