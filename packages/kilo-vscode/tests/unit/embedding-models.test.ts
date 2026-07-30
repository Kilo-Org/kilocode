import { afterEach, describe, expect, it } from "bun:test"
import { discoverEmbeddingModels, probeEmbeddingModel } from "../../src/indexing/embedding-models"

const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

describe("embedding model discovery", () => {
  it("discovers Ollama embedding capabilities and dimensions", async () => {
    const url = serve(async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/api/tags") {
        return Response.json({ models: [{ model: "chat" }, { model: "embed" }] })
      }
      const body = (await request.json()) as { model: string }
      if (body.model === "embed") {
        return Response.json({
          capabilities: ["embedding"],
          model_info: { "nomic-bert.embedding_length": 768 },
        })
      }
      return Response.json({ capabilities: ["completion"], model_info: { "llama.embedding_length": 4096 } })
    })

    expect(await discoverEmbeddingModels({ runtime: "ollama", baseURL: url })).toEqual([
      { id: "chat", name: "chat", embedding: "unsupported" },
      { id: "embed", name: "embed", embedding: "supported", dimension: 768 },
    ])
  })

  it("discovers and probes OpenAI-compatible models", async () => {
    const url = serve(async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/models") {
        return Response.json({ data: [{ id: "embed", name: "Embedding model" }] })
      }
      if (path === "/api/v1/models" || path === "/api/v0/models") return new Response(null, { status: 404 })
      const body = (await request.json()) as { model: string; input: string[] }
      expect(body.model).toBe("embed")
      return Response.json({
        data: body.input.map((_, index) => ({ embedding: [0.1, 0.2, 0.3], index })),
      })
    })

    expect(await discoverEmbeddingModels({ runtime: "openai-compatible", baseURL: `${url}/v1` })).toEqual([
      { id: "embed", name: "Embedding model", embedding: "unknown" },
    ])
    expect(await probeEmbeddingModel({ runtime: "openai-compatible", baseURL: `${url}/v1`, model: "embed" })).toEqual({
      id: "embed",
      name: "embed",
      embedding: "supported",
      dimension: 3,
      batchSize: 8,
    })
  })

  it("discovers LM Studio embedding metadata", async () => {
    const url = serve((request) => {
      if (new URL(request.url).pathname !== "/api/v1/models") return new Response(null, { status: 404 })
      return Response.json({
        models: [
          { id: "chat", type: "llm", max_context_length: 4096 },
          {
            key: "qwen",
            display_name: "Qwen Embedding",
            type: "embedding",
            max_context_length: 32768,
          },
        ],
      })
    })

    expect(await discoverEmbeddingModels({ runtime: "openai-compatible", baseURL: `${url}/v1` })).toEqual([
      { id: "qwen", name: "Qwen Embedding", embedding: "supported", maxTokens: 32768 },
    ])
  })

  it("falls back to a safe batch size", async () => {
    const url = serve(async (request) => {
      const body = (await request.json()) as { input: string[] }
      if (body.input.length > 2) return Response.json({ error: "out of memory" }, { status: 500 })
      return Response.json({ embeddings: body.input.map(() => [0.1, 0.2]) })
    })

    expect(await probeEmbeddingModel({ runtime: "ollama", baseURL: url, model: "qwen" })).toMatchObject({
      dimension: 2,
      batchSize: 2,
    })
  })
})
