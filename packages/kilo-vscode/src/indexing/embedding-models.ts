import { fetchOpenAIModels } from "../shared/fetch-models"

export type EmbeddingRuntime = "ollama" | "openai-compatible"

export type EmbeddingModel = {
  id: string
  name: string
  embedding: "supported" | "unsupported" | "unknown"
  dimension?: number
}

type Options = {
  runtime: EmbeddingRuntime
  baseURL: string
  apiKey?: string
  model?: string
}

type OllamaTag = {
  name?: string
  model?: string
}

type OllamaShow = {
  capabilities?: string[]
  model_info?: Record<string, unknown>
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function headers(key?: string) {
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

async function request(url: string, init?: RequestInit, timeout = 30_000) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  })
  if (response.ok) return response
  const body = await response.text().catch(() => "")
  throw new RequestError(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`, response.status)
}

function dimension(info: Record<string, unknown> | undefined) {
  if (!info) return undefined
  const entry = Object.entries(info).find(
    ([key, value]) => key.endsWith(".embedding_length") && !key.includes(".vision.") && Number(value) > 0,
  )
  return entry ? Number(entry[1]) : undefined
}

async function discoverOllama(baseURL: string): Promise<EmbeddingModel[]> {
  const base = baseURL.replace(/\/+$/, "")
  const response = await request(`${base}/api/tags`)
  const body = (await response.json()) as { models?: OllamaTag[] }
  const tags = Array.isArray(body.models) ? body.models : []
  const models = await Promise.all(
    tags.map(async (tag): Promise<EmbeddingModel | undefined> => {
      const id = tag.model?.trim() || tag.name?.trim() || ""
      if (!id) return undefined
      const response = await request(`${base}/api/show`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ model: id }),
      }).catch(() => undefined)
      if (!response) return { id, name: id, embedding: "unknown" }
      const show = (await response.json()) as OllamaShow
      const capabilities = show.capabilities ?? []
      const embedding = capabilities.includes("embedding")
        ? ("supported" as const)
        : capabilities.length > 0
          ? ("unsupported" as const)
          : ("unknown" as const)
      const size = embedding === "unsupported" ? undefined : dimension(show.model_info)
      return {
        id,
        name: id,
        embedding,
        ...(size ? { dimension: size } : {}),
      }
    }),
  )
  return models.filter((model): model is EmbeddingModel => !!model).sort((a, b) => a.id.localeCompare(b.id))
}

async function discoverOpenAI(baseURL: string, apiKey?: string): Promise<EmbeddingModel[]> {
  const models = await fetchOpenAIModels({ baseURL, apiKey })
  return models.map((model) => ({ ...model, embedding: "unknown" }))
}

async function probeOllama(baseURL: string, model: string) {
  const base = baseURL.replace(/\/+$/, "")
  const response = await request(
    `${base}/api/embed`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model, input: "test" }),
    },
    120_000,
  )
  const body = (await response.json()) as { embeddings?: number[][] }
  return body.embeddings?.[0]
}

async function probeOpenAI(baseURL: string, apiKey: string | undefined, model: string) {
  const base = baseURL.replace(/\/+$/, "")
  const run = (encoding: boolean) =>
    request(
      `${base}/embeddings`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model, input: "test", ...(encoding ? { encoding_format: "float" } : {}) }),
      },
      120_000,
    )
  const first = await run(true).catch((err) => {
    if (err instanceof RequestError && (err.status === 400 || err.status === 422)) return undefined
    throw err
  })
  const response = first ?? (await run(false))
  const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> }
  return body.data?.[0]?.embedding
}

export async function discoverEmbeddingModels(options: Options) {
  if (options.runtime === "ollama") return discoverOllama(options.baseURL)
  return discoverOpenAI(options.baseURL, options.apiKey)
}

export async function probeEmbeddingModel(options: Options): Promise<EmbeddingModel> {
  if (!options.model) throw new Error("Model is required")
  const vector =
    options.runtime === "ollama"
      ? await probeOllama(options.baseURL, options.model)
      : await probeOpenAI(options.baseURL, options.apiKey, options.model)
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Model "${options.model}" did not return a valid embedding`)
  }
  return {
    id: options.model,
    name: options.model,
    embedding: "supported",
    dimension: vector.length,
  }
}
