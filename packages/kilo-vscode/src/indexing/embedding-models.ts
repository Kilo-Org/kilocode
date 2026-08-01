import { fetchOpenAIModels } from "../shared/fetch-models"

export type EmbeddingRuntime = "ollama" | "openai-compatible"

export type EmbeddingModel = {
  id: string
  name: string
  embedding: "supported" | "unsupported" | "unknown"
  dimension?: number
  batchSize?: number
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

type LmModel = {
  id?: string
  key?: string
  display_name?: string
  type?: string
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

class BatchSizeError extends Error {}

function headers(key?: string) {
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

function isBatchError(err: unknown) {
  if (err instanceof BatchSizeError) return true
  if (!(err instanceof RequestError)) return false
  return err.status === 400 || err.status === 413 || err.status === 422 || (err.status >= 500 && err.status < 600)
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

function isLoopback(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
  } catch {
    return false
  }
}

async function discoverOpenAI(baseURL: string, apiKey?: string): Promise<EmbeddingModel[]> {
  const root = baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")
  const endpoints = [`${root}/api/v1/models`, `${root}/api/v0/models`]
  const native = async (remaining: string[]): Promise<LmModel[] | undefined> => {
    const url = remaining[0]
    if (!url) return undefined
    const response = await request(url, { headers: headers(apiKey) }).catch(() => undefined)
    if (!response) return native(remaining.slice(1))
    const body = (await response.json()) as { data?: LmModel[]; models?: LmModel[] }
    return Array.isArray(body.models) ? body.models : body.data
  }
  const local = isLoopback(baseURL) ? await native(endpoints) : undefined
  if (local) {
    const models = local
      .filter((model) => (model.type === "embedding" || model.type === "embeddings") && (model.key || model.id))
      .map((model) => {
        const id = model.key || model.id!
        return {
          id,
          name: model.display_name || id,
          embedding: "supported" as const,
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    if (models.length > 0) return models
  }
  const models = await fetchOpenAIModels({ baseURL, apiKey })
  return models.map((model) => ({ ...model, embedding: "unknown" }))
}

async function probeOllama(baseURL: string, model: string, input: string[]) {
  const base = baseURL.replace(/\/+$/, "")
  const response = await request(
    `${base}/api/embed`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model, input }),
    },
    120_000,
  )
  const body = (await response.json()) as { embeddings?: number[][] }
  return body.embeddings
}

async function probeOpenAI(baseURL: string, apiKey: string | undefined, model: string, input: string[]) {
  const base = baseURL.replace(/\/+$/, "")
  const run = (encoding: boolean) =>
    request(
      `${base}/embeddings`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model, input, ...(encoding ? { encoding_format: "float" } : {}) }),
      },
      120_000,
    )
  const first = await run(true).catch((err) => {
    if (err instanceof RequestError && (err.status === 400 || err.status === 422)) return undefined
    throw err
  })
  const response = first ?? (await run(false))
  const body = (await response.json()) as { data?: Array<{ embedding?: number[]; index?: number }> }
  return body.data
    ?.slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding)
}

export async function discoverEmbeddingModels(options: Options) {
  if (options.runtime === "ollama") return discoverOllama(options.baseURL)
  return discoverOpenAI(options.baseURL, options.apiKey)
}

export async function probeEmbeddingModel(options: Options): Promise<EmbeddingModel> {
  if (!options.model) throw new Error("Model is required")
  const sizes = [8, 4, 2, 1]
  const sample = "export function searchIndex(query: string) { return query.trim() }"
  const attempt = async (size: number) => {
    const input = Array.from({ length: size }, (_, index) => `${sample} // ${index}`)
    const vectors =
      options.runtime === "ollama"
        ? await probeOllama(options.baseURL, options.model!, input)
        : await probeOpenAI(options.baseURL, options.apiKey, options.model!, input)
    if (!vectors || vectors.length !== size) {
      throw new BatchSizeError(`expected ${size} embeddings, got ${vectors?.length ?? 0}`)
    }
    const dimension = vectors[0]?.length ?? 0
    if (
      dimension === 0 ||
      vectors.some(
        (vector) =>
          !Array.isArray(vector) || vector.length !== dimension || vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error("returned invalid or inconsistent embedding vectors")
    }
    return dimension
  }
  const check = async (
    remaining: number[],
    first?: unknown,
  ): Promise<{ profile?: { size: number; dimension: number }; error?: unknown }> => {
    const size = remaining[0]
    if (!size) return { error: first }
    try {
      return { profile: { size, dimension: await attempt(size) } }
    } catch (err) {
      if (!isBatchError(err)) return { error: err }
      const next = await check(remaining.slice(1), first ?? err)
      return next.profile ? next : { error: next.error ?? first ?? err }
    }
  }
  const result = await check(sizes)
  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error)
    throw new Error(`Model "${options.model}" embedding probe failed: ${message}`)
  }
  if (!result.profile?.dimension) {
    throw new Error(`Model "${options.model}" did not pass the embedding compatibility check`)
  }
  return {
    id: options.model,
    name: options.model,
    embedding: "supported",
    dimension: result.profile.dimension,
    ...(result.profile.size === sizes[0] ? {} : { batchSize: result.profile.size }),
  }
}
