---
title: "Codebase Indexing"
description: "Index your codebase for improved AI understanding"
---

# Codebase Indexing

Codebase Indexing enables semantic code search across your entire project using AI embeddings. Instead of searching for exact text matches, it understands the _meaning_ of your queries, helping Kilo Code find relevant code even when you don't know specific function names or file locations.

{% callout type="warning" title="Experimental" %}
Codebase Indexing is currently **experimental** in the CLI and the new VS Code extension. You must explicitly opt in before the feature becomes available — see the **Setup** section below. Behavior, configuration, and defaults may change in future releases.
{% /callout %}

## What It Does

When enabled, the indexing system:

1. **Parses your code** using Tree-sitter to identify semantic blocks (functions, classes, methods)
2. **Creates embeddings** of each code block using AI models
3. **Stores vectors** in a vector database for fast similarity search
4. **Provides the [`semantic_search`](/docs/automate/tools/semantic-search) tool** to Kilo Code for intelligent code discovery

This enables natural language queries like "user authentication logic" or "database connection handling" to find relevant code across your entire project.

## Key Benefits

- **Semantic Search**: Find code by meaning, not just keywords
- **Enhanced AI Understanding**: Kilo Code can better comprehend and work with your codebase
- **Cross-Project Discovery**: Search across all files, not just what's open
- **Pattern Recognition**: Locate similar implementations and code patterns

## Setup

{% tabs %}
{% tab label="VSCode" %}

### 1. Enable the experimental flag

Codebase Indexing is gated behind an experimental flag. Until the flag is on, the Indexing UI is hidden and `semantic_search` is unavailable.

1. Open Kilo Code **Settings** → **Experimental**.
2. Toggle **Semantic Indexing** on.
3. The **Indexing** tab will appear in Settings and the indexing status indicator will appear at the bottom of the prompt input panel.

Alternatively, set `experimental.semantic_indexing` to `true` in your `kilo.jsonc`:

```json
{
  "experimental": {
    "semantic_indexing": true
  }
}
```

### 2. Configure indexing

1. Open Kilo Code **Settings** → **Indexing**, or click the indexing indicator at the bottom of the prompt input panel.
2. Toggle **Enable Indexing** on.
3. Pick an **Embedding Provider** and fill in its required fields.
4. Pick a **Vector Store** (`Qdrant` or `LanceDB`) and configure it.
5. Optionally adjust **Tuning Parameters** (search score, batch size, retries, max results).
6. Save to start the initial scan.

You can also edit the `indexing` section in `kilo.jsonc` directly:

```json
{
  "indexing": {
    "enabled": true,
    "provider": "openai",
    "model": "text-embedding-3-small",
    "vectorStore": "lancedb",
    "openai": { "apiKey": "sk-..." },
    "lancedb": {}
  }
}
```

### Embedding providers

| Provider | How to use | Notes |
|---|---|---|
| **OpenAI** | API key | Default model: `text-embedding-3-small`. `text-embedding-3-large` for higher accuracy. |
| **Ollama** | Local base URL | No API costs. Runs fully offline. |
| **OpenAI-Compatible** | Base URL + API key | For self-hosted or third-party OpenAI-compatible endpoints. |
| **Gemini** | Google AI API key | Supports `gemini-embedding-001` and other Gemini embedding models. |
| **Mistral** | API key from [La Plateforme](https://console.mistral.ai/api-keys/) | Use a standard Mistral API key. The Codestral-specific keys from the [Mistral autocomplete setup guide](/docs/code-with-ai/features/autocomplete/mistral-setup) are **not** interchangeable — those only work for completion. |
| **Vercel AI Gateway** | API key | Routes requests through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). |
| **AWS Bedrock** | AWS region + profile | Uses the AWS SDK credential chain. |
| **OpenRouter** | API key (optional specific provider) | Routes through [OpenRouter](https://openrouter.ai/). |
| **Voyage** | API key | Voyage `voyage-code-3` is tuned for code. |

### Vector stores

- **Qdrant** (default) — external server. Recommended for team deployments and larger codebases. See [Setting Up Qdrant](#setting-up-qdrant).
- **LanceDB** — embedded, file-based. No server to run. Stores data under your Kilo data directory by default.

{% callout type="tip" %}
For a fully local, zero-cost setup, combine **Ollama** (embeddings) with **LanceDB** (vector store — no separate server needed).
{% /callout %}

### Status indicator

The prompt input panel shows a compact indexing status indicator that reflects the current state (Standby / In Progress / Complete / Error) along with progress when scanning or embedding.

{% /tab %}
{% tab label="CLI" %}

### 1. Enable the experimental flag

Codebase Indexing is gated behind an experimental flag. Until the flag is on, the `/indexing` command is hidden and `semantic_search` is unavailable.

Set the flag in your `kilo.jsonc`:

```json
{
  "experimental": {
    "semantic_indexing": true
  }
}
```

Restart the CLI for the change to take effect. The `/indexing` command (and aliases `/index`, `/embedding`) will appear in the command palette once the flag is active.

### 2. Configure indexing

Open a Kilo TUI session and run:

```text
/indexing
```

(aliases: `/index`, `/embedding`)

This opens an interactive configuration dialog where you can:

- **Toggle** indexing on/off
- Choose an **Embedding Provider** and fill in provider settings (API key, base URL, AWS region, etc.)
- Set the **Embedding Model** (blank = provider default)
- Set the **Vector Dimension** (blank = auto-detect from the model)
- Choose a **Vector Store** (`Qdrant` or `LanceDB`) and configure its connection
- Adjust **Tuning Parameters** (search threshold, batch size, retries, max results)

All changes are written to your `kilo.jsonc` config and take effect immediately.

You can also edit the `indexing` section directly. This is the full shape of the section:

```json
{
  "indexing": {
    "enabled": true,
    "provider": "voyage",
    "model": "voyage-code-3",
    "dimension": 1024,
    "vectorStore": "qdrant",
    "voyage": {
      "apiKey": "pa-..."
    },
    "qdrant": {
      "url": "http://localhost:6333",
      "apiKey": ""
    },
    "searchMinScore": 0.4,
    "searchMaxResults": 50,
    "embeddingBatchSize": 60,
    "scannerMaxBatchRetries": 3
  }
}
```

### Embedding providers

| Provider | Config key | Settings | Notes |
|---|---|---|---|
| **OpenAI** | `openai` | `{ apiKey }` | Default: `text-embedding-3-small`. |
| **Ollama** | `ollama` | `{ baseUrl }` | No API costs. Runs fully offline. |
| **OpenAI-Compatible** | `openai-compatible` | `{ baseUrl, apiKey }` | For self-hosted or third-party endpoints. |
| **Gemini** | `gemini` | `{ apiKey }` | Supports `gemini-embedding-001`. |
| **Mistral** | `mistral` | `{ apiKey }` | Use a [La Plateforme](https://console.mistral.ai/api-keys/) key — the Codestral-specific keys from the [autocomplete setup guide](/docs/code-with-ai/features/autocomplete/mistral-setup) don't work for embeddings. |
| **Vercel AI Gateway** | `vercel-ai-gateway` | `{ apiKey }` | Routes through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). |
| **AWS Bedrock** | `bedrock` | `{ region, profile }` | Uses AWS SDK credential chain. |
| **OpenRouter** | `openrouter` | `{ apiKey, specificProvider? }` | Routes through [OpenRouter](https://openrouter.ai/). |
| **Voyage** | `voyage` | `{ apiKey }` | `voyage-code-3` is tuned for code. |

### Vector stores

- `qdrant` — `{ url?, apiKey? }` (default). See [Setting Up Qdrant](#setting-up-qdrant).
- `lancedb` — `{ directory? }` — embedded, file-based. No server to run. Uses a default Kilo data directory when omitted.

{% callout type="tip" %}
For a fully local, zero-cost setup, combine **Ollama** (embeddings) with **LanceDB** (vector store — no separate server needed).
{% /callout %}

### Status indicator

When indexing is enabled, the CLI shows an indexing status badge at the bottom of the TUI in the form `IDX <state>` (for example `IDX In Progress 40% 120/300`, `IDX Complete`, `IDX Standby`, or `IDX Error <message>`).

{% /tab %}
{% tab label="VSCode (Legacy)" %}

The legacy extension does not require an experimental flag.

### Open Codebase Indexing Settings

1. In the chat header, click the database icon (indexing status).
2. The Codebase Indexing settings panel opens.
3. If you don't see the icon, open Kilo Code settings ({% codicon name="gear" /%}) and search for **Codebase Indexing**.

{% image src="/docs/img/codebase-indexing/codebase-indexing.png" alt="Codebase Indexing Settings" width="800" caption="Codebase Indexing Settings (legacy)" /%}

### Configure Settings

1. Enable **"Enable Codebase Indexing"** using the toggle switch.
2. Configure your embedding provider:
   - **OpenAI**: Enter API key and select model
   - **Gemini**: Enter Google AI API key and select embedding model
   - **Ollama**: Enter base URL and select model
3. Set Qdrant URL and optional API key.
4. Configure **Max Search Results** (default: 20, range: 1-100).
5. Click **Save** to start initial indexing.

### Embedding providers

The legacy extension supports a smaller set of providers:

| Provider | How to use | Notes |
|---|---|---|
| **OpenAI** | API key | Default: `text-embedding-3-small`. |
| **Gemini** | Google AI API key | Supports Gemini embedding models including `gemini-embedding-001`. |
| **Ollama (local)** | Local base URL | No API costs. |

### Vector store

The legacy extension only supports **Qdrant**. See [Setting Up Qdrant](#setting-up-qdrant).

{% /tab %}
{% /tabs %}

## Setting Up Qdrant

If you choose **Qdrant** as your vector store, you need a running Qdrant server.

### Quick Local Setup

**Using Docker:**

```bash
docker run -p 6333:6333 qdrant/qdrant
```

**Using Docker Compose:**

```yaml
version: "3.8"
services:
  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
    volumes:
      - qdrant_storage:/qdrant/storage
volumes:
  qdrant_storage:
```

### Production Deployment

For team or production use:

- [Qdrant Cloud](https://cloud.qdrant.io/) — managed service
- Self-hosted on AWS, GCP, or Azure
- Local server with network access for team sharing

## Understanding Index Status

The interface shows real-time status:

- **Standby**: Not running, awaiting configuration or paused
- **In Progress**: Currently processing files (with a progress percentage and `processed/total` count)
- **Complete**: Up-to-date and ready for searches
- **Error**: Failed state, with an error message
- **Disabled**: Indexing is turned off or not yet configured

## How Files Are Processed

### Smart Code Parsing

- **Tree-sitter Integration**: Uses AST parsing to identify semantic code blocks
- **Language Support**: Broad language coverage via Tree-sitter — C, C#, C++, CSS, Elisp, Elixir, Go, HTML, Java, JavaScript, Kotlin, Lua, OCaml, PHP, Python, Ruby, Rust, Scala, Solidity, Swift, SystemRDL, TLA+, TOML, TSX, TypeScript, Vue, Zig, and more
- **Markdown Support**: Dedicated parser for markdown and documentation
- **Fallback**: Line-based chunking for unsupported file types
- **Block Sizing**:
  - Minimum: 100 characters
  - Maximum: 1,000 characters
  - Splits large functions intelligently

### Automatic File Filtering

The indexer automatically excludes:

- Binary files and images
- Large files (&gt;1MB)
- Git repositories (`.git` folders)
- Dependencies (`node_modules`, `vendor`, etc.)
- Files matching `.gitignore` and [`.kilocodeignore`](/docs/customize/context/kilocodeignore) patterns

### Incremental Updates

- **File Watching**: Monitors the workspace for changes and re-indexes in the background
- **Smart Updates**: Only reprocesses modified files
- **Hash-based Caching**: Avoids reprocessing unchanged content
- **Branch Switching**: Automatically handles Git branch changes

## Tuning Parameters

These advanced settings live under the `indexing` key and are exposed in the CLI's `/indexing → Tuning Parameters` menu and the VS Code extension's Indexing settings:

| Setting | Default | Description |
|---|---|---|
| `searchMinScore` | `0.4` | Minimum cosine similarity (0-1) for a result to be returned. |
| `searchMaxResults` | `50` | Maximum number of results returned per search. |
| `embeddingBatchSize` | `60` | Number of code segments per embedding batch. Lower this if your embedding endpoint has strict rate limits. |
| `scannerMaxBatchRetries` | `3` | Maximum retry attempts for a failed embedding batch. |

## Best Practices

### Model Selection

**OpenAI:**

- **`text-embedding-3-small`**: Best balance of performance and cost
- **`text-embedding-3-large`**: Higher accuracy, 5x more expensive
- **`text-embedding-ada-002`**: Legacy model, lower cost

**Ollama:**

- **`mxbai-embed-large`**: The largest and highest-quality embedding model
- **`nomic-embed-text`**: Best balance of performance and embedding quality
- **`all-minilm`**: Compact model with lower quality but faster performance

**Voyage:**

- **`voyage-code-3`**: Code-tuned embeddings; strong default for source-heavy repos

### Security Considerations

- **API Keys**: Stored in your `kilo.jsonc` config. Treat that file as a secret in shared environments.
- **Code Privacy**: Only small code snippets are sent for embedding — never whole files.
- **Local Processing**: All parsing (Tree-sitter) happens locally.
- **Fully Local Option**: Pair **Ollama** (embeddings) with **LanceDB** (local vector store) for a setup that never leaves your machine.
- **Qdrant Security**: Use authentication for production deployments.

## Current Limitations

- **File Size**: 1MB maximum per file
- **Single Workspace**: One workspace at a time
- **Dependencies**: Requires an embedding provider, and — for Qdrant — a running Qdrant instance
- **Language Coverage**: Optimal parsing is limited to Tree-sitter supported languages

## Troubleshooting

### Embeddings fail or indexing stalls (llama.cpp / Ollama)

If your local embedding server is based on llama.cpp (including Ollama), indexing can fail with errors about `n_ubatch` or `GGML_ASSERT`. Ensure both batch size (`-b`) and micro-batch size (`-ub`) are set to the same value for embedding models, then restart the server. For Ollama, configure `num_batch` in your Modelfile or request options to match the same effective value.

### Indexing status stays on "Disabled"

- Check that `indexing.enabled` is `true` in your `kilo.jsonc`
- Verify that the selected provider has all required credentials set
- If using Qdrant, make sure the Qdrant server is reachable at the configured URL

### Rate-limit or batch errors with a hosted provider

Lower `embeddingBatchSize` under `indexing` (default `60`). Smaller batches send fewer segments per request and are less likely to hit per-request or per-minute rate limits.

## Using the Search Feature

Once indexed, Kilo Code can use the [`semantic_search`](/docs/automate/tools/semantic-search) tool to find relevant code:

**Example Queries:**

- "How is user authentication handled?"
- "Database connection setup"
- "Error handling patterns"
- "API endpoint definitions"

The tool provides Kilo Code with:

- Relevant code snippets (up to your configured `searchMaxResults`)
- File paths and line numbers
- Similarity scores
- Contextual information

### Search Results Configuration

Tune result volume and quality via:

- **`searchMaxResults`** — default `50`. Lower for faster, more focused responses; higher for more context.
- **`searchMinScore`** — default `0.4`. Raise to require closer matches; lower to include more tangentially related code.

## Privacy & Security

- **Code stays local**: Only small code snippets are sent for embedding
- **Embeddings are numeric**: Not human-readable representations
- **Secure storage**: API keys are stored in your local `kilo.jsonc` configuration
- **Fully local option**: Use **Ollama + LanceDB** for completely local processing
- **Access control**: Respects existing file permissions and `.kilocodeignore`
