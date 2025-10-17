# Provider Configuration Guide

This guide provides detailed information on how to configure each provider in Kilo Code CLI. Each provider has specific configuration requirements and optional settings that can be customized to suit your needs.

## Table of Contents

- [Introduction](#introduction)
- [Configuration Methods](#configuration-methods)
- [Provider Details](#provider-details)
    - [Kilo Code](#kilocode)
    - [Anthropic](#anthropic)
    - [OpenAI Native](#openai-native)
    - [OpenRouter](#openrouter)
    - [AWS Bedrock](#bedrock)
    - [Google Gemini](#gemini)
    - [Google Vertex AI](#vertex)
    - [Claude Code](#claude-code)
    - [Mistral](#mistral)
    - [Groq](#groq)
    - [DeepSeek](#deepseek)
    - [xAI](#xai)
    - [Cerebras](#cerebras)
    - [Ollama](#ollama)
    - [LM Studio](#lmstudio)
    - [VSCode Language Model](#vscode-lm)
    - [OpenAI](#openai)
    - [Glama](#glama)
    - [HuggingFace](#huggingface)
    - [LiteLLM](#litellm)
    - [Moonshot](#moonshot)
    - [Doubao](#doubao)
    - [Chutes](#chutes)
    - [SambaNova](#sambanova)
    - [Fireworks](#fireworks)
    - [Featherless](#featherless)
    - [DeepInfra](#deepinfra)
    - [IO Intelligence](#io-intelligence)
    - [Qwen Code](#qwen-code)
    - [Gemini CLI](#gemini-cli)
    - [ZAI](#zai)
    - [Unbound](#unbound)
    - [Requesty](#requesty)
    - [Roo](#roo)
    - [Vercel AI Gateway](#vercel-ai-gateway)
    - [Virtual Quota Fallback](#virtual-quota-fallback)
    - [Human Relay](#human-relay)
    - [Fake AI](#fake-ai)

## Introduction

Kilo Code CLI supports multiple AI providers, each with their own configuration requirements. This document details the configuration fields for each provider, including required and optional parameters.

## Configuration Methods

You can configure providers using:

1. **Interactive CLI**: Run `kilocode config` to configure providers interactively
2. **Configuration File**: Edit your configuration file directly (typically located in your user config directory)
3. **Environment Variables**: Some providers support environment variable configuration

---

## Provider Details

### kilocode

The official Kilo Code provider for accessing Kilo Code's managed AI services.

**Description**: Access Kilo Code's managed AI infrastructure with support for multiple models and organizations.

**Required Fields**:

- `kilocodeToken` (password): Your Kilo Code authentication token
- `kilocodeModel` (text): The model to use (default: `anthropic/claude-sonnet-4.5`)

**Optional Fields**:

- `kilocodeOrganizationId` (text): Organization ID for team accounts (leave empty for personal use)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "kilocode",
	"kilocodeToken": "your-token-here",
	"kilocodeModel": "anthropic/claude-sonnet-4",
	"kilocodeOrganizationId": "org-123456"
}
```

**Default Model**: `anthropic/claude-sonnet-4.5`

---

### anthropic

Direct integration with Anthropic's Claude API.

**Description**: Use Claude models directly from Anthropic with your own API key.

**Required Fields**:

- `apiKey` (password): Your Anthropic API key
- `apiModelId` (text): The Claude model to use (default: `claude-sonnet-4.5`)

**Optional Fields**:

- `anthropicBaseUrl` (text): Custom base URL for API requests (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "anthropic",
	"apiKey": "sk-ant-...",
	"apiModelId": "claude-sonnet-4.5",
	"anthropicBaseUrl": ""
}
```

**Default Model**: `claude-sonnet-4.5`

**Notes**:

- Requires an Anthropic API key from https://console.anthropic.com/
- Supports all Claude 3 and Claude 3.5 models

---

### openai-native

Native OpenAI API integration.

**Description**: Use OpenAI's models with native API support.

**Required Fields**:

- `openAiNativeApiKey` (password): Your OpenAI API key
- `apiModelId` (text): The OpenAI model to use (default: `gpt-5-chat-latest`)

**Optional Fields**:

- `openAiNativeBaseUrl` (text): Custom base URL for API requests (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "openai-native",
	"openAiNativeApiKey": "sk-...",
	"apiModelId": "gpt-5-chat-latest",
	"openAiNativeBaseUrl": ""
}
```

**Default Model**: `gpt-5-chat-latest`

**Notes**:

- Requires an OpenAI API key from https://platform.openai.com/
- Supports GPT-4, GPT-4 Turbo, and GPT-3.5 models

---

### openrouter

Access multiple AI models through OpenRouter's unified API.

**Description**: Use OpenRouter to access various AI models from different providers through a single API.

**Required Fields**:

- `openRouterApiKey` (password): Your OpenRouter API key
- `openRouterModelId` (text): The model identifier (default: `anthropic/claude-3-5-sonnet`)

**Optional Fields**:

- `openRouterBaseUrl` (text): Custom base URL (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "openrouter",
	"openRouterApiKey": "sk-or-...",
	"openRouterModelId": "anthropic/claude-3-5-sonnet",
	"openRouterBaseUrl": ""
}
```

**Default Model**: `anthropic/claude-3-5-sonnet`

**Notes**:

- Get your API key from https://openrouter.ai/
- Supports models from Anthropic, OpenAI, Google, Meta, and more

---

### bedrock

AWS Bedrock for accessing foundation models on AWS infrastructure.

**Description**: Use AWS Bedrock to access various foundation models with AWS security and compliance.

**Required Fields**:

- `awsAccessKey` (password): Your AWS access key ID
- `awsSecretKey` (password): Your AWS secret access key
- `awsRegion` (text): AWS region (default: `us-east-1`)
- `apiModelId` (text): The model to use (default: `anthropic.claude-sonnet-4.5-20250929-v1:0`)

**Optional Fields**:

- `awsSessionToken` (password): AWS session token for temporary credentials
- `awsUseCrossRegionInference` (boolean): Enable cross-region inference

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "bedrock",
	"awsAccessKey": "AKIA...",
	"awsSecretKey": "...",
	"awsRegion": "us-east-1",
	"apiModelId": "anthropic.claude-sonnet-4.5-20250929-v1:0",
	"awsSessionToken": "",
	"awsUseCrossRegionInference": false
}
```

**Default Model**: `anthropic.claude-sonnet-4.5-20250929-v1:0`

**Notes**:

- Requires AWS account with Bedrock access
- Supports Claude, Llama, Mistral, and other foundation models
- Cross-region inference allows access to models in different regions

---

### gemini

Google's Gemini AI models via direct API access.

**Description**: Access Google's Gemini models directly with your API key.

**Required Fields**:

- `geminiApiKey` (password): Your Google AI API key
- `apiModelId` (text): The model to use (default: `gemini-2.5-flash-preview-04-17`)

**Optional Fields**:

- `googleGeminiBaseUrl` (text): Custom base URL (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "gemini",
	"geminiApiKey": "AIza...",
	"apiModelId": "gemini-2.5-flash-preview-04-17",
	"googleGeminiBaseUrl": ""
}
```

**Default Model**: `gemini-2.5-flash-preview-04-17`

**Notes**:

- Get your API key from https://makersuite.google.com/app/apikey
- Supports Gemini Pro and Gemini Ultra models

---

### vertex

Google Cloud Vertex AI for enterprise-grade AI deployment.

**Description**: Use Google Cloud's Vertex AI platform for accessing AI models with enterprise features.

**Required Fields**:

- `vertexProjectId` (text): Your Google Cloud project ID
- `vertexRegion` (text): Google Cloud region (default: `us-central1`)
- `apiModelId` (text): The model to use (default: `claude-4.5-sonnet`)

**Authentication** (choose one):

- `vertexJsonCredentials` (password): JSON service account credentials
- `vertexKeyFile` (text): Path to service account key file

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "vertex",
	"vertexProjectId": "my-project-123",
	"vertexRegion": "us-central1",
	"apiModelId": "claude-4.5-sonnet",
	"vertexJsonCredentials": "{...}",
	"vertexKeyFile": ""
}
```

**Default Model**: `claude-4.5-sonnet`

**Notes**:

- Requires Google Cloud project with Vertex AI enabled
- Supports Claude, Gemini, and other models through Vertex AI
- Use either JSON credentials or key file path, not both

---

### claude-code

Local Claude Code CLI integration.

**Description**: Use the Claude Code CLI tool for local AI interactions.

**Required Fields**:

- `claudeCodePath` (text): Path to the Claude Code executable
- `apiModelId` (text): The model to use (default: `claude-sonnet-4-5`)
- `claudeCodeMaxOutputTokens` (text): Maximum output tokens (default: `8000`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "claude-code",
	"claudeCodePath": "/usr/local/bin/claude-code",
	"apiModelId": "claude-sonnet-4-5",
	"claudeCodeMaxOutputTokens": "8000"
}
```

**Default Model**: `claude-sonnet-4-5`

**Notes**:

- Requires Claude Code CLI to be installed locally
- Useful for offline or local-first workflows

---

### mistral

Mistral AI's language models.

**Description**: Access Mistral's powerful language models including Codestral for code generation.

**Required Fields**:

- `mistralApiKey` (password): Your Mistral API key
- `apiModelId` (text): The model to use (default: `magistral-medium-latest`)

**Optional Fields**:

- `mistralCodestralUrl` (text): Custom Codestral base URL (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "mistral",
	"mistralApiKey": "...",
	"apiModelId": "magistral-medium-latest",
	"mistralCodestralUrl": ""
}
```

**Default Model**: `magistral-medium-latest`

**Notes**:

- Get your API key from https://console.mistral.ai/
- Supports Mistral Large, Mistral Medium, and Codestral models

---

### groq

Groq's ultra-fast LPU inference.

**Description**: Use Groq's Language Processing Unit (LPU) for extremely fast inference.

**Required Fields**:

- `groqApiKey` (password): Your Groq API key
- `apiModelId` (text): The model to use (default: `llama-3.3-70b-versatile`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "groq",
	"groqApiKey": "gsk_...",
	"apiModelId": "llama-3.3-70b-versatile"
}
```

**Default Model**: `llama-3.3-70b-versatile`

**Notes**:

- Get your API key from https://console.groq.com/
- Known for extremely fast inference speeds
- Supports Llama, Mixtral, and Gemma models

---

### deepseek

DeepSeek's AI models.

**Description**: Access DeepSeek's language models optimized for coding and reasoning.

**Required Fields**:

- `deepSeekApiKey` (password): Your DeepSeek API key
- `apiModelId` (text): The model to use (default: `deepseek-chat`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "deepseek",
	"deepSeekApiKey": "...",
	"apiModelId": "deepseek-chat"
}
```

**Default Model**: `deepseek-chat`

**Notes**:

- Get your API key from https://platform.deepseek.com/
- Optimized for code generation and technical tasks

---

### xai

xAI's Grok models.

**Description**: Access xAI's Grok language models.

**Required Fields**:

- `xaiApiKey` (password): Your xAI API key
- `apiModelId` (text): The model to use (default: `grok-code-fast-1`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "xai",
	"xaiApiKey": "...",
	"apiModelId": "grok-code-fast-1"
}
```

**Default Model**: `grok-code-fast-1`

**Notes**:

- Get your API key from https://x.ai/
- Access to Grok models

---

### cerebras

Cerebras AI inference platform.

**Description**: Use Cerebras' wafer-scale AI inference platform.

**Required Fields**:

- `cerebrasApiKey` (password): Your Cerebras API key
- `apiModelId` (text): The model to use (default: `qwen-3-coder-480b-free`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "cerebras",
	"cerebrasApiKey": "...",
	"apiModelId": "qwen-3-coder-480b-free"
}
```

**Default Model**: `qwen-3-coder-480b-free`

**Notes**:

- Get your API key from https://cerebras.ai/
- Optimized for high-throughput inference

---

### ollama

Local Ollama instance for running models locally.

**Description**: Run AI models locally using Ollama.

**Required Fields**:

- `ollamaBaseUrl` (text): Ollama server URL (default: `http://localhost:11434`)
- `ollamaModelId` (text): Model identifier (default: `llama3.2`)

**Optional Fields**:

- `ollamaApiKey` (password): API key if authentication is enabled

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "ollama",
	"ollamaBaseUrl": "http://localhost:11434",
	"ollamaModelId": "llama3.2",
	"ollamaApiKey": ""
}
```

**Default Model**: `llama3.2`

**Notes**:

- Requires Ollama to be installed and running locally
- Download from https://ollama.ai/
- Supports many open-source models (Llama, Mistral, CodeLlama, etc.)
- No API key required for local usage

---

### lmstudio

LM Studio for local model inference.

**Description**: Use LM Studio to run models locally with a user-friendly interface.

**Required Fields**:

- `lmStudioBaseUrl` (text): LM Studio server URL (default: `http://localhost:1234/v1`)
- `lmStudioModelId` (text): Model identifier (default: `local-model`)

**Optional Fields**:

- `lmStudioSpeculativeDecodingEnabled` (boolean): Enable speculative decoding for faster inference

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "lmstudio",
	"lmStudioBaseUrl": "http://localhost:1234/v1",
	"lmStudioModelId": "local-model",
	"lmStudioSpeculativeDecodingEnabled": false
}
```

**Default Model**: `local-model`

**Notes**:

- Requires LM Studio to be installed and running
- Download from https://lmstudio.ai/
- Supports various quantized models
- Speculative decoding can improve inference speed

---

### vscode-lm

VSCode's built-in language model API.

**Description**: Use VSCode's native language model capabilities (e.g., GitHub Copilot).

**Required Fields**:

- `vsCodeLmModelSelector` (text): Model selector in format `vendor/family`

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "vscode-lm",
	"vsCodeLmModelSelector": {
		"vendor": "copilot",
		"family": "gpt-4o"
	}
}
```

**Default Model**: `copilot-gpt-4o`

**Notes**:

- Requires VSCode with language model support
- Typically used with GitHub Copilot subscription
- No separate API key needed

---

### openai

OpenAI API integration (alternative configuration).

**Description**: Alternative OpenAI integration with simplified configuration.

**Required Fields**:

- `openAiApiKey` (password): Your OpenAI API key
- `apiModelId` (text): The model to use (default: `gpt-4o`)

**Optional Fields**:

- `openAiBaseUrl` (text): Custom base URL (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "openai",
	"openAiApiKey": "sk-...",
	"apiModelId": "gpt-4o",
	"openAiBaseUrl": ""
}
```

**Default Model**: `gpt-4o`

**Notes**:

- Similar to openai-native but with different configuration structure
- Supports all OpenAI models

---

### glama

Glama AI platform.

**Description**: Access AI models through the Glama platform.

**Required Fields**:

- `glamaApiKey` (password): Your Glama API key
- `glamaModelId` (text): Model identifier (default: `llama-3.1-70b-versatile`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "glama",
	"glamaApiKey": "...",
	"glamaModelId": "llama-3.1-70b-versatile"
}
```

**Default Model**: `llama-3.1-70b-versatile`

---

### huggingface

HuggingFace Inference API.

**Description**: Access models hosted on HuggingFace's inference infrastructure.

**Required Fields**:

- `huggingFaceApiKey` (password): Your HuggingFace API token
- `huggingFaceModelId` (text): Model identifier (default: `meta-llama/Llama-2-70b-chat-hf`)
- `huggingFaceInferenceProvider` (text): Inference provider (default: `auto`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "huggingface",
	"huggingFaceApiKey": "hf_...",
	"huggingFaceModelId": "meta-llama/Llama-2-70b-chat-hf",
	"huggingFaceInferenceProvider": "auto"
}
```

**Default Model**: `meta-llama/Llama-2-70b-chat-hf`

**Notes**:

- Get your token from https://huggingface.co/settings/tokens
- Supports thousands of models from the HuggingFace Hub
- Inference provider can be `auto`, `hf-inference`, or specific endpoints

---

### litellm

LiteLLM proxy for unified model access.

**Description**: Use LiteLLM as a proxy to access multiple AI providers through a unified interface.

**Required Fields**:

- `litellmBaseUrl` (text): LiteLLM proxy URL
- `litellmApiKey` (password): API key for the proxy
- `litellmModelId` (text): Model identifier (default: `gpt-4o`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "litellm",
	"litellmBaseUrl": "http://localhost:8000",
	"litellmApiKey": "...",
	"litellmModelId": "gpt-4o"
}
```

**Default Model**: `gpt-4o`

**Notes**:

- Requires LiteLLM proxy to be running
- See https://docs.litellm.ai/ for setup
- Supports 100+ LLM providers through a single interface

---

### moonshot

Moonshot AI platform.

**Description**: Access Moonshot AI's language models.

**Required Fields**:

- `moonshotBaseUrl` (text): Moonshot API base URL (default: `https://api.moonshot.ai/v1`)
- `moonshotApiKey` (password): Your Moonshot API key
- `apiModelId` (text): The model to use (default: `kimi-k2-0711-preview`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "moonshot",
	"moonshotBaseUrl": "https://api.moonshot.ai/v1",
	"moonshotApiKey": "...",
	"apiModelId": "kimi-k2-0711-preview"
}
```

**Default Model**: `kimi-k2-0711-preview`

---

### doubao

Doubao AI platform.

**Description**: Access Doubao's AI models.

**Required Fields**:

- `doubaoApiKey` (password): Your Doubao API key
- `apiModelId` (text): The model to use (default: `doubao-seed-1-6-250615`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "doubao",
	"doubaoApiKey": "...",
	"apiModelId": "doubao-seed-1-6-250615"
}
```

**Default Model**: `doubao-seed-1-6-250615`

---

### chutes

Chutes AI platform.

**Description**: Access AI models through the Chutes platform.

**Required Fields**:

- `chutesApiKey` (password): Your Chutes API key
- `apiModelId` (text): The model to use (default: `deepseek-ai/DeepSeek-R1-0528`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "chutes",
	"chutesApiKey": "...",
	"apiModelId": "deepseek-ai/DeepSeek-R1-0528"
}
```

**Default Model**: `deepseek-ai/DeepSeek-R1-0528`

---

### sambanova

SambaNova AI inference platform.

**Description**: Use SambaNova's AI inference platform for fast model execution.

**Required Fields**:

- `sambaNovaApiKey` (password): Your SambaNova API key
- `apiModelId` (text): The model to use (default: `Meta-Llama-3.1-70B-Instruct`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "sambanova",
	"sambaNovaApiKey": "...",
	"apiModelId": "Meta-Llama-3.1-70B-Instruct"
}
```

**Default Model**: `Meta-Llama-3.1-70B-Instruct`

---

### fireworks

Fireworks AI platform.

**Description**: Access models through Fireworks AI's fast inference platform.

**Required Fields**:

- `fireworksApiKey` (password): Your Fireworks API key
- `apiModelId` (text): The model to use (default: `accounts/fireworks/models/kimi-k2-instruct-0905`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "fireworks",
	"fireworksApiKey": "...",
	"apiModelId": "accounts/fireworks/models/kimi-k2-instruct-0905"
}
```

**Default Model**: `accounts/fireworks/models/kimi-k2-instruct-0905`

**Notes**:

- Get your API key from https://fireworks.ai/
- Known for fast inference speeds

---

### featherless

Featherless AI platform.

**Description**: Access AI models through the Featherless platform.

**Required Fields**:

- `featherlessApiKey` (password): Your Featherless API key
- `apiModelId` (text): The model to use (default: `deepseek-ai/DeepSeek-V3-0324`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "featherless",
	"featherlessApiKey": "...",
	"apiModelId": "deepseek-ai/DeepSeek-V3-0324"
}
```

**Default Model**: `deepseek-ai/DeepSeek-V3-0324`

---

### deepinfra

DeepInfra's serverless AI inference.

**Description**: Use DeepInfra for serverless access to various AI models.

**Required Fields**:

- `deepInfraApiKey` (password): Your DeepInfra API key
- `deepInfraModelId` (text): Model identifier (default: `meta-llama/Meta-Llama-3.1-70B-Instruct`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "deepinfra",
	"deepInfraApiKey": "...",
	"deepInfraModelId": "meta-llama/Meta-Llama-3.1-70B-Instruct"
}
```

**Default Model**: `meta-llama/Meta-Llama-3.1-70B-Instruct`

**Notes**:

- Get your API key from https://deepinfra.com/
- Supports many open-source models

---

### io-intelligence

IO Intelligence platform.

**Description**: Access AI models through the IO Intelligence platform.

**Required Fields**:

- `ioIntelligenceApiKey` (password): Your IO Intelligence API key
- `ioIntelligenceModelId` (text): Model identifier (default: `gpt-4o`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "io-intelligence",
	"ioIntelligenceApiKey": "...",
	"ioIntelligenceModelId": "gpt-4o"
}
```

**Default Model**: `gpt-4o`

---

### qwen-code

Qwen Code AI models.

**Description**: Access Qwen's code-specialized models using OAuth authentication.

**Required Fields**:

- `qwenCodeOauthPath` (text): Path to OAuth credentials file (default: `~/.qwen/oauth_creds.json`)
- `apiModelId` (text): The model to use (default: `qwen3-coder-plus`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "qwen-code",
	"qwenCodeOauthPath": "~/.qwen/oauth_creds.json",
	"apiModelId": "qwen3-coder-plus"
}
```

**Default Model**: `qwen3-coder-plus`

**Notes**:

- Requires OAuth credentials file
- Optimized for code generation tasks

---

### gemini-cli

Gemini CLI integration.

**Description**: Use Google's Gemini models through CLI with OAuth authentication.

**Required Fields**:

- `geminiCliOAuthPath` (text): Path to OAuth credentials file (default: `~/.gemini/oauth_creds.json`)
- `geminiCliProjectId` (text): Google Cloud project ID
- `apiModelId` (text): The model to use (default: `gemini-2.5-flash-preview-04-17`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "gemini-cli",
	"geminiCliOAuthPath": "~/.gemini/oauth_creds.json",
	"geminiCliProjectId": "my-project-123",
	"apiModelId": "gemini-2.5-flash-preview-04-17"
}
```

**Default Model**: `gemini-2.5-flash-preview-04-17`

**Notes**:

- Requires OAuth credentials file
- Requires Google Cloud project

---

### zai

ZAI AI platform.

**Description**: Access AI models through the ZAI platform with support for both international and China-based API endpoints.

**Required Fields**:

- `zaiApiKey` (password): Your ZAI API key
- `zaiApiLine` (text): API line identifier (default: `international_coding`)
- `apiModelId` (text): The model to use (default: `glm-4.6`)

**Available API Lines**:

The `zaiApiLine` parameter determines which API endpoint and region to use:

- `international_coding` (default): International Coding Plan

    - Base URL: `https://api.z.ai/api/coding/paas/v4`
    - Region: International
    - Optimized for coding tasks

- `international`: International Standard

    - Base URL: `https://api.z.ai/api/paas/v4`
    - Region: International
    - General-purpose API

- `china_coding`: China Coding Plan

    - Base URL: `https://open.bigmodel.cn/api/coding/paas/v4`
    - Region: China
    - Optimized for coding tasks

- `china`: China Standard
    - Base URL: `https://open.bigmodel.cn/api/paas/v4`
    - Region: China
    - General-purpose API

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "zai",
	"zaiApiKey": "...",
	"zaiApiLine": "international_coding",
	"apiModelId": "glm-4.6"
}
```

**Default Model**: `glm-4.6`

**Notes**:

- Choose the API line based on your geographic location and use case
- Coding-optimized lines provide better performance for code generation tasks
- China-based lines may offer better latency for users in mainland China

---

### unbound

Unbound AI platform.

**Description**: Access AI models through the Unbound platform.

**Required Fields**:

- `unboundApiKey` (password): Your Unbound API key
- `unboundModelId` (text): Model identifier (default: `gpt-4o`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "unbound",
	"unboundApiKey": "...",
	"unboundModelId": "gpt-4o"
}
```

**Default Model**: `gpt-4o`

---

### requesty

Requesty AI platform.

**Description**: Access AI models through the Requesty platform.

**Required Fields**:

- `requestyApiKey` (password): Your Requesty API key
- `requestyModelId` (text): Model identifier (default: `gpt-4o`)

**Optional Fields**:

- `requestyBaseUrl` (text): Custom base URL (leave empty for default)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "requesty",
	"requestyApiKey": "...",
	"requestyBaseUrl": "",
	"requestyModelId": "gpt-4o"
}
```

**Default Model**: `gpt-4o`

---

### roo

Roo AI platform.

**Description**: Access AI models through the Roo platform.

**Required Fields**:

- `apiModelId` (text): Model identifier (default: `deepseek-ai/DeepSeek-R1-0528`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "roo",
	"apiModelId": "deepseek-ai/DeepSeek-R1-0528"
}
```

**Default Model**: `deepseek-ai/DeepSeek-R1-0528`

**Notes**:

- No API key required
- Configuration may vary based on platform setup

---

### vercel-ai-gateway

Vercel AI Gateway for unified model access.

**Description**: Use Vercel's AI Gateway to access multiple AI providers.

**Required Fields**:

- `vercelAiGatewayApiKey` (password): Your Vercel AI Gateway API key
- `vercelAiGatewayModelId` (text): Model identifier (default: `gpt-4o`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "vercel-ai-gateway",
	"vercelAiGatewayApiKey": "...",
	"vercelAiGatewayModelId": "gpt-4o"
}
```

**Default Model**: `gpt-4o`

**Notes**:

- Requires Vercel account with AI Gateway enabled
- Provides unified access to multiple AI providers

---

### virtual-quota-fallback

Virtual quota management with automatic fallback.

**Description**: Manage multiple provider profiles with automatic fallback when quotas are exceeded.

**Required Fields**:

- `profiles` (text): Array of provider profiles with quota configurations

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "virtual-quota-fallback",
	"profiles": [
		{
			"provider": "anthropic",
			"quota": 1000000,
			"config": {
				"apiKey": "...",
				"apiModelId": "claude-3-5-sonnet-20241022"
			}
		},
		{
			"provider": "openai",
			"quota": 500000,
			"config": {
				"openAiApiKey": "...",
				"apiModelId": "gpt-4o"
			}
		}
	]
}
```

**Default Model**: `gpt-4o`

**Notes**:

- Automatically switches to fallback providers when quota is exceeded
- Useful for managing costs and ensuring availability
- Each profile can have its own quota and configuration

---

### human-relay

Human-in-the-loop relay for manual responses.

**Description**: Route requests to a human operator for manual responses.

**Required Fields**:

- `apiModelId` (text): Model identifier (fixed value: `human`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "human-relay",
	"apiModelId": "human"
}
```

**Default Model**: `human`

**Notes**:

- Used for testing or scenarios requiring human intervention
- No AI model is actually called

---

### fake-ai

Fake AI provider for testing and development.

**Description**: Mock AI provider for testing purposes without making actual API calls.

**Required Fields**:

- `apiModelId` (text): Model identifier (fixed value: `fake-model`)

**Example Configuration**:

```json
{
	"id": "default",
	"provider": "fake-ai",
	"apiModelId": "fake-model"
}
```

**Default Model**: `fake-model`

**Notes**:

- Used for testing and development
- Returns mock responses without calling any actual AI service
- Useful for integration testing

---

## Additional Resources

- [Kilo Code Documentation](https://docs.kilocode.com/)
- [Configuration Schema](../src/config/schema.json)

## Support

For issues or questions about provider configuration:

- Open an issue on [GitHub](https://github.com/kilo-org/kilocode)
- Join our [Discord community](https://discord.gg/kilocode)
- Check the [FAQ](https://docs.kilocode.com/faq)
