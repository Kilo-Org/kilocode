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
      const body = (await request.json()) as { model: string }
      expect(body.model).toBe("embed")
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
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
})
