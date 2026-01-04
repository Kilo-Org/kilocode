---
title: ZenMux
---

import Codicon from "@site/src/components/Codicon";

# Using ZenMux With Kilo Code

[ZenMux](https://zenmux.ai) provides a unified API gateway to access multiple AI models from different providers through a single endpoint. It supports OpenAI, Anthropic, Google, and other major AI providers, automatically handling routing, fallbacks, and cost optimization.

## Getting Started

1. **Sign up for ZenMux:** Visit [zenmux.ai](https://zenmux.ai) to create an account.
2. **Get your API key:** After signing up, navigate to your dashboard to generate an API key.
3. **Configure in Kilo Code:** Add your API key to Kilo Code settings.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "ZenMux" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your ZenMux API key into the "ZenMux API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.
5. **(Optional) Custom Base URL:** If you need to use a custom base URL for the ZenMux API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

## Supported Models

ZenMux supports a wide range of models from various providers:

Visi [zenmux.ai/models](https://zenmux.ai/models) to see the complete list of available models.

### Other Providers

ZenMux also supports models from Meta, Mistral, and many other providers. Check your ZenMux dashboard for the complete list of available models.

## API Compatibility

ZenMux provides multiple API endpoints for different protocols:

### OpenAI Compatible API

Use the standard OpenAI SDK with ZenMux's base URL:

```javascript
import OpenAI from "openai"

const openai = new OpenAI({
	baseURL: "https://zenmux.ai/api/v1",
	apiKey: "<ZENMUX_API_KEY>",
})

async function main() {
	const completion = await openai.chat.completions.create({
		model: "openai/gpt-5",
		messages: [
			{
				role: "user",
				content: "What is the meaning of life?",
			},
		],
	})

	console.log(completion.choices[0].message)
}

main()
```

### Anthropic API

For Anthropic models, use the dedicated endpoint:

```typescript
import Anthropic from "@anthropic-ai/sdk"

// 1. Initialize the Anthropic client
const anthropic = new Anthropic({
	// 2. Replace with the API key from your ZenMux console
	apiKey: "<YOUR ZENMUX_API_KEY>",
	// 3. Point the base URL to the ZenMux endpoint
	baseURL: "https://zenmux.ai/api/anthropic",
})

async function main() {
	const msg = await anthropic.messages.create({
		model: "anthropic/claude-sonnet-4.5",
		max_tokens: 1024,
		messages: [{ role: "user", content: "Hello, Claude" }],
	})
	console.log(msg)
}

main()
```

### Platform API

The Get generation interface is used to query generation information, such as usage and costs.

```bash
curl https://zenmux.ai/api/v1/generation?id=<generation_id> \
  -H "Authorization: Bearer $ZENMUX_API_KEY"
```

### Google Vertex AI API

For Google models:

```typescript
const genai = require("@google/genai")

const client = new genai.GoogleGenAI({
	apiKey: "$ZENMUX_API_KEY",
	vertexai: true,
	httpOptions: {
		baseUrl: "https://zenmux.ai/api/vertex-ai",
		apiVersion: "v1",
	},
})

const response = await client.models.generateContent({
	model: "google/gemini-2.5-pro",
	contents: "How does AI work?",
})
console.log(response)
```

## Features

### Automatic Routing

ZenMux automatically routes your requests to the best available provider based on:

- Model availability
- Response time
- Cost optimization
- Provider health status

### Fallback Support

If a provider is unavailable, ZenMux automatically falls back to alternative providers that support the same model capabilities.

### Cost Optimization

ZenMux can be configured to optimize for cost, routing requests to the most cost-effective provider while maintaining quality.

### Zero Data Retention (ZDR)

Enable ZDR mode to ensure that no request or response data is stored by ZenMux, providing maximum privacy for sensitive applications.

## Advanced Configuration

### Provider Routing

You can specify routing preferences:

- **Price**: Route to the lowest cost provider
- **Throughput**: Route to the provider with highest tokens/second
- **Latency**: Route to the provider with fastest response time

### Data Collection Settings

Control how ZenMux handles your data:

- **Allow**: Allow data collection for service improvement
- **Deny**: Disable all data collection

### Middle-Out Transform

Enable the middle-out transform feature to optimize prompts that exceed model context limits.

## Troubleshooting

### API Key Issues

- Ensure your API key is correctly copied without any extra spaces
- Check that your ZenMux account is active and has available credits
- Verify the API key has the necessary permissions

### Model Availability

- Some models may have regional restrictions
- Check the ZenMux dashboard for current model availability
- Ensure your account tier has access to the desired models

### Connection Issues

- Verify your internet connection
- Check if you're behind a firewall that might block API requests
- Try using a custom base URL if the default endpoint is blocked

## Support

For additional support:

- Visit the [ZenMux documentation](https://zenmux.ai/docs)
- Contact ZenMux support through their dashboard
- Check the [Kilo Code GitHub repository](https://github.com/kilocode/kilocode) for integration-specific issues
