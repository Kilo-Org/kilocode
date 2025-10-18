---
sidebar_label: AIStupidLevel
---

# Using AIStupidLevel With Kilo Code

AIStupidLevel is an intelligent AI router that continuously benchmarks 25+ AI models across multiple providers and automatically routes your requests to the best-performing model based on real-time performance data.

**Website:** [https://aistupidlevel.info](https://aistupidlevel.info)

## What is AIStupidLevel?

AIStupidLevel is a smart AI router that provides:

- **Real-time performance benchmarking** of 25+ AI models from OpenAI, Anthropic, Google, xAI, and more
- **Intelligent routing** based on hourly speed tests and daily deep reasoning benchmarks
- **7-axis scoring methodology** (Correctness, Spec Compliance, Code Quality, Efficiency, Stability, Refusal Rate, Recovery)
- **Statistical degradation detection** to automatically avoid poorly performing models
- **Cost optimization** with automatic provider switching
- **Multiple routing strategies** optimized for different use cases

Instead of manually choosing between GPT-4, Claude, Gemini, or other models, AIStupidLevel automatically selects the optimal model for your task based on continuous performance monitoring.

## Getting an API Key

1. **Sign Up:** Go to [https://aistupidlevel.info](https://aistupidlevel.info) and create an account
2. **Navigate to Router:** Click on the "Router" section in the dashboard
3. **Add Provider Keys:** Add your API keys for the providers you want to use (OpenAI, Anthropic, Google, xAI, etc.)
4. **Generate Router Key:** Create a router API key that Kilo Code will use
5. **Copy the Key:** Copy your AIStupidLevel router API key

## Available Routing Strategies

AIStupidLevel offers different "auto" models that optimize for specific use cases:

| Model | Description | Best For |
|-------|-------------|----------|
| `auto` | Best overall performance across all metrics | General-purpose tasks |
| `auto-coding` | Optimized for code generation and quality | Software development, debugging |
| `auto-reasoning` | Best for complex reasoning and problem-solving | Deep analysis, mathematical problems |
| `auto-creative` | Optimized for creative writing quality | Content creation, storytelling |
| `auto-cheapest` | Most cost-effective option | High-volume, budget-conscious tasks |
| `auto-fastest` | Fastest response time | Real-time applications, quick queries |

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "AIStupidLevel" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your AIStupidLevel router API key into the "AIStupidLevel API Key" field.
4. **Select Model:** Choose your desired routing strategy from the "Model" dropdown (e.g., `auto-coding`, `auto-reasoning`, etc.).

## How It Works

When you make a request through Kilo Code:

1. **AIStupidLevel analyzes** current model performance from continuous benchmarks
2. **Selects the optimal model** based on your chosen routing strategy
3. **Routes your request** using your configured provider API keys
4. **Returns the response** with metadata about which model was selected

The router automatically:
- Avoids models experiencing performance degradation
- Routes to cheaper models when performance is comparable
- Provides transparent routing decisions in response headers

## Key Features

- **Degradation Protection:** Automatically avoids models with performance issues
- **Cost Optimization:** Routes to cheaper models when performance is comparable
- **Provider Diversity:** Access models from OpenAI, Anthropic, Google, xAI, DeepSeek, and more through one API
- **Transparent Routing:** Response headers show which model was selected and why
- **Performance Tracking:** Dashboard shows your usage, cost savings, and routing decisions
- **Enterprise SLA:** 99.9% uptime guarantee with multi-region deployment

## Response Headers

AIStupidLevel includes custom headers in responses to show routing decisions:

```
X-AISM-Provider: anthropic
X-AISM-Model: claude-sonnet-4-20250514
X-AISM-Reasoning: Selected claude-sonnet-4-20250514 from anthropic for best coding capabilities (score: 42.3). Ranked #1 of 12 available models. Last updated 2h ago.
```

## Pricing

AIStupidLevel charges only for the underlying model usage (at cost) plus a small routing fee. You can monitor costs in real-time through the dashboard at [https://aistupidlevel.info/router](https://aistupidlevel.info/router).

## Tips and Notes

- **Provider Keys Required:** You must add your own provider API keys (OpenAI, Anthropic, etc.) to your AIStupidLevel dashboard before using the router
- **Model Selection:** The router automatically selects the best model based on real-time benchmarks - you don't need to manually switch models
- **Performance Monitoring:** Check the [AIStupidLevel dashboard](https://aistupidlevel.info) to see live performance rankings and routing decisions
- **Cost Tracking:** The dashboard shows your cost savings compared to always using premium models

## Learn More

- **Website:** [https://aistupidlevel.info](https://aistupidlevel.info)
- **Router Dashboard:** [https://aistupidlevel.info/router](https://aistupidlevel.info/router)
- **Live Benchmarks:** [https://aistupidlevel.info](https://aistupidlevel.info)
- **Community:** [r/AIStupidLevel](https://www.reddit.com/r/AIStupidlevel)
- **Twitter/X:** [@AIStupidlevel](https://x.com/AIStupidlevel)
