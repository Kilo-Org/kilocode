# Services - Code Index Feature

**Quick Navigation for AI Agents**

---

## Overview

Code embedding and semantic search system. Creates vector embeddings of code for intelligent search. Supports 8 embedding providers.

**Source Location**: `src/services/code-index/`

---

## Components

| Component | Type | Location |
|-----------|------|----------|
| Embedders | Module | `embedders/` |
| CacheManager | Class | `cache-manager.ts` |
| ConfigManager | Class | `config-manager.ts` |

---

## Documentation Files

- **[Embedders.md](./Embedders.md)** - Embedding providers
- **[CacheManager.md](./CacheManager.md)** - Embedding cache

---

## Embedding Providers

| Provider | File | API |
|----------|------|-----|
| OpenAI | `openai.ts` | OpenAI Embeddings |
| Gemini | `gemini.ts` | Google Embeddings |
| Mistral | `mistral.ts` | Mistral Embeddings |
| OpenRouter | `openrouter.ts` | OpenRouter |
| Bedrock | `bedrock.ts` | AWS Bedrock |
| Ollama | `ollama.ts` | Local Ollama |
| Vercel AI Gateway | `vercel-ai-gateway.ts` | Vercel |
| OpenAI Compatible | `openai-compatible.ts` | Generic |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Create embedding | `embed()` | `embedders/*.ts` |
| Search code | `search()` | `code-index/` |
| Cache embedding | `cache()` | `cache-manager.ts` |
| Configure embedder | `configure()` | `config-manager.ts` |

---

## How It Works

1. **Index**: Chunk code files into segments
2. **Embed**: Create vector embeddings for each chunk
3. **Store**: Cache embeddings in vector DB
4. **Search**: Find similar code via vector similarity

---

## Interfaces

| Interface | File | Purpose |
|-----------|------|---------|
| `cache.ts` | `interfaces/cache.ts` | Cache interface |
| `config.ts` | `interfaces/config.ts` | Config interface |
| `embedder.ts` | `interfaces/embedder.ts` | Embedder interface |

---

## Related

- [Search Tools](../../../core/features/tools/search-tools/) - CodebaseSearchTool
- [Tree-sitter](../tree-sitter/) - Code parsing for indexing

---

[← Back to Services](../../Feature-Index.md)
