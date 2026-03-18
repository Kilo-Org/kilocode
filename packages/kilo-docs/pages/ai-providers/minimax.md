---
sidebar_label: MiniMax
---

# Using MiniMax With Kilo Code

MiniMax is a global AI foundation model company focused on fast, cost-efficient multimodal models with strong coding, tool-use, and agentic capabilities. Their flagship MiniMax-M2.7 model delivers peak performance with enhanced reasoning and coding capabilities, a 204,800-token context window, high-speed inference, and advanced development workflow support.

**Website:** [https://www.minimax.io/](https://www.minimax.io/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [MiniMax Console](https://platform.minimax.io/). Create an account or sign in.
2. **Open the API Keys Page:** Navigate to your **Profile > API Keys**.
3. **Create a Key:** Click to generate a new API key and give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** Copy the key immediately. You may not be able to view it again. Store it securely.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Navigate to **Providers**. Choose **MiniMax** from the API Provider dropdown.
3. **Enter API Key:** Paste your MiniMax API key into the MiniMax API Key field.
4. **Select Model:** Choose your desired MiniMax model from the Model dropdown.

## Available Models

| Model | Description | Context Window |
|-------|------------|---------------|
| **MiniMax-M2.7** | Latest flagship model with enhanced reasoning and coding. | 204,800 tokens |
| **MiniMax-M2.7-highspeed** | High-speed version of M2.7 for low-latency scenarios. | 204,800 tokens |
| **MiniMax-M2.5** | Peak performance. Ultimate value. Master the complex. | 204,800 tokens |
| **MiniMax-M2.5-highspeed** | Same performance, faster and more agile. | 204,800 tokens |

## Pricing

| Model | Input | Output | Prompt Caching Read | Prompt Caching Write |
|-------|-------|--------|---------------------|----------------------|
| MiniMax-M2.7 | $0.30 / M tokens | $1.20 / M tokens | $0.06 / M tokens | $0.375 / M tokens |
| MiniMax-M2.7-highspeed | $0.60 / M tokens | $2.40 / M tokens | $0.06 / M tokens | $0.375 / M tokens |
| MiniMax-M2.5 | $0.30 / M tokens | $1.20 / M tokens | $0.03 / M tokens | $0.375 / M tokens |
| MiniMax-M2.5-highspeed | $0.60 / M tokens | $2.40 / M tokens | $0.06 / M tokens | $0.375 / M tokens |

## Tips and Notes

- **Performance:** MiniMax-M2.7 is the latest flagship model with enhanced reasoning and coding capabilities.
- **Context Window:** All MiniMax models support a 204,800-token context window, suitable for large codebases and complex agent workflows.
- **Speed:** Use `MiniMax-M2.7-highspeed` for faster inference while maintaining the same level of performance.
- **API Documentation:** See the [MiniMax API Reference](https://platform.minimax.io/docs/api-reference/text-anthropic-api) for detailed API documentation.
