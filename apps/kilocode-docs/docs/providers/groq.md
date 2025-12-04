---
sidebar_label: Groq
---

# Using Groq With Kilo Code

Groq provides ultra-fast inference for various AI models through their high-performance infrastructure. Kilo Code supports accessing models through the Groq API.

**Website:** [https://groq.com/](https://groq.com/)

## Getting an API Key

To use Groq with Kilo Code, you'll need an API key from the [GroqCloud Console](https://console.groq.com/). After signing up or logging in, navigate to the API Keys section of your dashboard to create and copy your key.

## Supported Models

Kilo Code will attempt to fetch the list of available models from the Groq API. Common models available via Groq include:

- `llama3-8b-8192`
- `llama3-70b-8192`
- `mixtral-8x7b-32768`
- `gemma-7b-it`
- `moonshotai/kimi-k2-instruct` (Kimi K2 model)

**Note:** Model availability and specifications may change. Refer to the [Groq Documentation](https://console.groq.com/docs/models) for the most up-to-date list of supported models and their capabilities.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Groq" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Groq API key into the "Groq API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

- **High-Speed Inference:** Groq's LPUs provide exceptionally fast response times, making it ideal for interactive development workflows.
- **Token Limits:** Some models have specific `max_tokens` limits that are automatically handled by Kilo Code (e.g., the `moonshotai/kimi-k2-instruct` model).
- **Cost Efficiency:** Groq often provides competitive pricing for high-speed inference compared to other providers.
- **Model Selection:** Choose models based on your specific needs - larger models like `llama3-70b-8192` for complex reasoning tasks, or smaller models like `llama3-8b-8192` for faster, simpler operations.

## Supported Models

Kilo Code supports the following models through Groq:

| Model ID                      | Provider    | Context Window | Notes                                 |
| ----------------------------- | ----------- | -------------- | ------------------------------------- |
| `moonshotai/kimi-k2-instruct` | Moonshot AI | 128K tokens    | Optimized max_tokens limit configured |
| `llama-3.3-70b-versatile`     | Meta        | 128K tokens    | High-performance Llama model          |
| `llama-3.1-70b-versatile`     | Meta        | 128K tokens    | Versatile reasoning capabilities      |
| `llama-3.1-8b-instant`        | Meta        | 128K tokens    | Fast inference for quick tasks        |
| `mixtral-8x7b-32768`          | Mistral AI  | 32K tokens     | Mixture of experts architecture       |

**Note:** Model availability may change. Refer to the [Groq documentation](https://console.groq.com/docs/models) for the latest model list and specifications.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "Groq" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Groq API key into the "Groq API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

## Model-Specific Features

### Kimi K2 Model

The `moonshotai/kimi-k2-instruct` model includes optimized configuration:

- **Max Tokens Limit:** Automatically configured with appropriate limits for optimal performance
- **Context Understanding:** Excellent for complex reasoning and long-context tasks
- **Multilingual Support:** Strong performance across multiple languages

## Tips and Notes

- **Ultra-Fast Inference:** Groq's hardware acceleration provides exceptionally fast response times
- **Cost-Effective:** Competitive pricing for high-performance inference
- **Rate Limits:** Be aware of API rate limits based on your Groq plan
- **Model Selection:** Choose models based on your specific use case:
    - **Kimi K2**: Best for complex reasoning and multilingual tasks
    - **Llama 3.3 70B**: Excellent general-purpose performance
    - **Llama 3.1 8B Instant**: Fastest responses for simple tasks
    - **Mixtral**: Good balance of performance and efficiency

## Troubleshooting

- **"Invalid API Key":** Verify your API key is correct and active in the Groq Console
- **"Model Not Available":** Check if the selected model is available in your region
- **Rate Limit Errors:** Monitor your usage in the Groq Console and consider upgrading your plan
- **Connection Issues:** Ensure you have a stable internet connection and Groq services are operational

## Pricing

Groq offers competitive pricing based on input and output tokens. Visit the [Groq pricing page](https://groq.com/pricing/) for current rates and plan options.
