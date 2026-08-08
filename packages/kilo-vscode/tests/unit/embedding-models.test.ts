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
    })
  })

  it("discovers LM Studio embedding metadata", async () => {
    const url = serve((request) => {
      if (new URL(request.url).pathname !== "/api/v1/models") return new Response(null, { status: 404 })
      return Response.json({
        models: [
          { id: "chat", type: "llm" },
          {
            key: "qwen",
            display_name: "Qwen Embedding",
            type: "embedding",
          },
        ],
      })
    })

    expect(await discoverEmbeddingModels({ runtime: "openai-compatible", baseURL: `${url}/v1` })).toEqual([
      { id: "qwen", name: "Qwen Embedding", embedding: "supported" },
    ])
  })

  it("falls back when native metadata has no embedding models", async () => {
    const url = serve((request) => {
      const path = new URL(request.url).pathname
      if (path === "/api/v1/models") return Response.json({ models: [{ id: "chat", type: "llm" }] })
      if (path === "/api/v0/models") return new Response(null, { status: 404 })
      if (path === "/v1/models") return Response.json({ data: [{ id: "embed", name: "Embedding model" }] })
      return new Response(null, { status: 404 })
    })

    expect(await discoverEmbeddingModels({ runtime: "openai-compatible", baseURL: `${url}/v1` })).toEqual([
      { id: "embed", name: "Embedding model", embedding: "unknown" },
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

  it("falls back for batch-shaped errors and incomplete responses", async () => {
    const sizes: number[] = []
    const url = serve(async (request) => {
      const body = (await request.json()) as { input: string[] }
      const size = body.input.length
      sizes.push(size)
      if (size === 8) return Response.json({ error: "batch input is unsupported" }, { status: 400 })
      return Response.json({ embeddings: [[0.1, 0.2]] })
    })

    await expect(probeEmbeddingModel({ runtime: "ollama", baseURL: url, model: "qwen" })).resolves.toMatchObject({
      dimension: 2,
      batchSize: 1,
    })
    expect(sizes).toEqual([8, 4, 2, 1])
  })

  it("reports non-batch probe failures without retrying", async () => {
    let calls = 0
    const url = serve(() => {
      calls += 1
      return new Response("invalid key", { status: 401 })
    })

    await expect(probeEmbeddingModel({ runtime: "ollama", baseURL: url, model: "qwen" })).rejects.toThrow(
      'Model "qwen" embedding probe failed: HTTP 401: invalid key',
    )
    expect(calls).toBe(1)
  })
})
