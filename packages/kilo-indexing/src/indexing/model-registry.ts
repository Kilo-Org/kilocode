/**
 * Indexing-local embedding model metadata registry.
 *
 * RATIONALE: The legacy codebase imported model metadata from a shared module
 * (`shared/embeddingModels`) that does not exist in this package. Rather than
 * recreating the full legacy module, we keep a focused registry of the models
 * the indexing engine needs to know about — primarily for dimension resolution,
 * default model selection, and score thresholds.
 */

import type { EmbedderProvider } from "./interfaces/manager"

interface ModelProfile {
  dimension: number
  scoreThreshold?: number
  queryPrefix?: string
}

// ASSUMPTION: These dimensions and defaults match the provider documentation
// as of 2025-Q1. Update when providers ship new embedding models.
const profiles: Record<string, Record<string, ModelProfile>> = {
  openai: {
    "text-embedding-3-small": { dimension: 1536, scoreThreshold: 0.4 },
    "text-embedding-3-large": { dimension: 3072, scoreThreshold: 0.4 },
    "text-embedding-ada-002": { dimension: 1536, scoreThreshold: 0.4 },
  },
  ollama: {
    "nomic-embed-text": { dimension: 768, scoreThreshold: 0.3, queryPrefix: "search_query: " },
    "mxbai-embed-large": { dimension: 1024, scoreThreshold: 0.3 },
    "all-minilm": { dimension: 384, scoreThreshold: 0.3 },
  },
  gemini: {
    "gemini-embedding-001": { dimension: 3072, scoreThreshold: 0.35 },
    "text-embedding-004": { dimension: 768, scoreThreshold: 0.35 },
    "embedding-001": { dimension: 768, scoreThreshold: 0.35 },
  },
  mistral: {
    "codestral-embed-2505": { dimension: 1536, scoreThreshold: 0.35 },
    "codestral-embed": { dimension: 1536, scoreThreshold: 0.35 },
    "mistral-embed": { dimension: 1024, scoreThreshold: 0.35 },
  },
  voyage: {
    "voyage-code-3": { dimension: 1024, scoreThreshold: 0.35 },
    "voyage-3": { dimension: 1024, scoreThreshold: 0.35 },
    "voyage-3-lite": { dimension: 512, scoreThreshold: 0.35 },
  },
  bedrock: {
    "amazon.titan-embed-text-v2:0": { dimension: 1024, scoreThreshold: 0.35 },
    "amazon.titan-embed-text-v1": { dimension: 1536, scoreThreshold: 0.35 },
    "cohere.embed-english-v3": { dimension: 1024, scoreThreshold: 0.35 },
  },
  openrouter: {
    "openai/text-embedding-3-small": { dimension: 1536, scoreThreshold: 0.4 },
    "openai/text-embedding-3-large": { dimension: 3072, scoreThreshold: 0.4 },
  },
  "openai-compatible": {},
  "vercel-ai-gateway": {
    "text-embedding-3-small": { dimension: 1536, scoreThreshold: 0.4 },
  },
}

const defaults: Record<string, string> = {
  openai: "text-embedding-3-small",
  ollama: "nomic-embed-text",
  gemini: "gemini-embedding-001",
  mistral: "codestral-embed-2505",
  voyage: "voyage-code-3",
  bedrock: "amazon.titan-embed-text-v2:0",
  openrouter: "openai/text-embedding-3-small",
  "openai-compatible": "",
  "vercel-ai-gateway": "text-embedding-3-small",
}

export function getDefaultModelId(provider: EmbedderProvider): string {
  return defaults[provider] ?? ""
}

export function getModelDimension(provider: EmbedderProvider, modelId: string): number | undefined {
  return profiles[provider]?.[modelId]?.dimension
}

export function getModelScoreThreshold(provider: EmbedderProvider, modelId: string): number | undefined {
  return profiles[provider]?.[modelId]?.scoreThreshold
}

export function getModelQueryPrefix(provider: EmbedderProvider, modelId: string): string | undefined {
  return profiles[provider]?.[modelId]?.queryPrefix
}
