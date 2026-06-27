import { describe, expect, test } from "bun:test"
import type { Provider } from "@kilocode/sdk/v2"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { encodeMetadata, PROVIDER_ID, type Metadata } from "../../../src/kilocode/anaconda-desktop/domain"
import { CatalogProvider, hooks, PLACEHOLDER_MODEL_ID } from "../../../src/kilocode/anaconda-desktop/provider"

const metadata: Metadata = {
  version: "1",
  serverID: "server-1",
  baseURL: "http://127.0.0.1:8080/v1",
  models: [
    {
      id: "model.gguf",
      name: "Local Model",
      family: "gemma",
      input: ["text", "image"],
      output: ["text"],
      description: "This local model does not support tool calling.",
    },
  ],
  context: 131_072,
  toolcall: "unsupported",
}

const provider: Provider = {
  id: PROVIDER_ID,
  name: CatalogProvider.name,
  source: "custom",
  env: [],
  options: {},
  models: {},
}

describe("Anaconda Desktop plugin", () => {
  test("loads only the safe OpenAI-compatible base URL", async () => {
    const plugin = hooks()
    const loader = plugin.auth?.loader
    if (!loader) throw new Error("auth loader is missing")
    const encoded = encodeMetadata(metadata)
    if (!encoded) throw new Error("metadata did not encode")

    const options = await loader(async () => ({ type: "api", key: "test-inference-key", metadata: encoded }), provider)
    expect(options).toEqual({ baseURL: metadata.baseURL })
    expect(JSON.stringify(options)).not.toContain("test-inference-key")
  })

  test("replaces the placeholder with stored active-server models", async () => {
    const plugin = hooks()
    const load = plugin.provider?.models
    if (!load) throw new Error("provider model hook is missing")
    const encoded = encodeMetadata(metadata)
    if (!encoded) throw new Error("metadata did not encode")

    const models = await load(provider, { auth: { type: "api", key: "test-inference-key", metadata: encoded } })
    expect(Object.keys(models)).toEqual(["model.gguf"])
    expect(models[PLACEHOLDER_MODEL_ID]).toBeUndefined()
    expect(models["model.gguf"]).toMatchObject({
      providerID: PROVIDER_ID,
      api: {
        id: "model.gguf",
        url: "http://127.0.0.1:8080/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        attachment: true,
        toolcall: false,
        input: { text: true, image: true },
        output: { text: true },
      },
      limit: { context: 131_072, output: 0 },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    })
  })

  test("uses the stored key through the standard OpenAI-compatible runtime", async () => {
    const key = "fixture-standard-runtime-key"
    const requests: Array<{ path: string; authorization: string | null }> = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push({
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
        })
        return Response.json({
          id: "fixture-completion",
          object: "chat.completion",
          created: 0,
          model: "model.gguf",
          choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })

    try {
      const port = server.port
      if (port === undefined) throw new Error("runtime fixture did not bind a port")
      const sdk = createOpenAICompatible({
        name: PROVIDER_ID,
        baseURL: `http://127.0.0.1:${port}/v1`,
        apiKey: key,
      })
      const result = await generateText({ model: sdk.languageModel("model.gguf"), prompt: "hello" })

      expect(result.text).toBe("ready")
      expect(requests).toEqual([{ path: "/v1/chat/completions", authorization: `Bearer ${key}` }])
    } finally {
      server.stop(true)
    }
  })
})
