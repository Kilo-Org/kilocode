# API Providers - Local Models

**Quick Navigation for AI Agents**

---

## Overview

Local model providers. Run AI models on your own hardware with Ollama or LM Studio.

**Source Location**: `src/api/providers/ollama.ts`, `src/api/providers/lmstudio.ts`

---

## Ollama

### Configuration

| Setting | Type | Description |
|---------|------|-------------|
| baseUrl | string | Ollama server URL (default: `http://localhost:11434`) |
| model | string | Model name |

### Popular Models

| Model | Size | Best For |
|-------|------|----------|
| llama3.1:70b | 40GB | Complex tasks |
| llama3.1:8b | 4.7GB | General use |
| codellama:34b | 19GB | Coding |
| mistral:7b | 4.1GB | Fast, efficient |
| deepseek-coder:33b | 19GB | Coding |

### Commands

```bash
# Install model
ollama pull llama3.1:8b

# Run Ollama server
ollama serve
```

---

## LM Studio

### Configuration

| Setting | Type | Description |
|---------|------|-------------|
| baseUrl | string | LM Studio URL (default: `http://localhost:1234`) |
| model | string | Model path |

### Features

- GUI for model management
- OpenAI-compatible API
- Model download/import
- GPU acceleration

---

## Advantages

- **Privacy**: Data stays local
- **Cost**: No API fees
- **Speed**: No network latency
- **Customization**: Fine-tune models

---

## Requirements

- Sufficient RAM (8GB+ for small models)
- GPU recommended (NVIDIA/AMD)
- Storage for models (4-100GB)

---

[← Back to API Providers](../../Feature-Index.md)
