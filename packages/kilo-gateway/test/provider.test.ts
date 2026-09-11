import { describe, expect, test } from "bun:test"
import { zstdDecompressSync } from "node:zlib"
import { buildRequestHeaders, createKilo } from "../src/provider"
import type { KiloProvider, KiloProviderOptions, LanguageModelV3 } from "../src/types"

const adapters = {
  openrouter: (provider: KiloProvider) => provider.languageModel("test-model"),
  openai: (provider: KiloProvider) => provider.openai("gpt-5"),
  anthropic: (provider: KiloProvider) => provider.anthropic("claude-sonnet-4"),
  compatible: (provider: KiloProvider) => provider.openaiCompatible("test-model"),
}
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
type Call = Parameters<LanguageModelV3["doGenerate"]>[0]
const prompt: Call["prompt"] = [
  {
    role: "user",
    content: [
      { type: "text", text: "image details 文字\n".repeat(8_000) },
      { type: "file", data: new URL(image), mediaType: "image/png" },
    ],
  },
]

async function capture(
  input: {
    options?: KiloProviderOptions
    kind?: keyof typeof adapters
    method?: "doGenerate" | "doStream"
    call?: Partial<Call>
  } = {},
) {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const error = new Error("captured")
  const provider = createKilo({
    kilocodeToken: "test-token",
    ...input.options,
    fetch: async (url, init) => {
      if (!init) throw new Error("Missing request options")
      requests.push({ url: url instanceof Request ? url.url : String(url), init })
      throw error
    },
  })
  const model = adapters[input.kind ?? "openai"](provider)
  if (typeof model === "string" || model.specificationVersion !== "v3") throw new Error("Expected V3 model")
  await expect(model[input.method ?? "doGenerate"]({ prompt, ...input.call })).rejects.toBe(error)
  expect(requests).toHaveLength(1)
  const request = requests.at(0)
  if (!request) throw new Error("Missing captured request")
  return request
}

describe("Kilo provider request headers", () => {
  test("request headers override provider defaults", () => {
    const headers = buildRequestHeaders(
      {
        "content-type": "application/json",
        "x-kilocode-feature": "vscode-extension",
        "x-default-only": "kept",
      },
      {
        "x-kilocode-feature": "agent-manager",
        "x-request-only": "kept-too",
      },
    )

    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-kilocode-feature")).toBe("agent-manager")
    expect(headers.get("x-default-only")).toBe("kept")
    expect(headers.get("x-request-only")).toBe("kept-too")
  })
})

describe("Kilo request compression", () => {
  for (const kind of ["openrouter", "openai", "anthropic", "compatible"] as const) {
    for (const method of ["doGenerate", "doStream"] as const) {
      test(`${kind} ${method} preserves the complete request`, async () => {
        const controller = new AbortController()
        const call = {
          abortSignal: controller.signal,
          headers: { "x-request": "kept", "content-length": "999999" },
        }
        const plain = await capture({ kind, method, call, options: { requestCompression: false } })
        const encoded = await capture({ kind, method, call })
        expect(encoded.url).toBe(plain.url)
        if (typeof plain.init.body !== "string" || !(encoded.init.body instanceof Uint8Array))
          throw new Error("Unexpected request body type")
        expect(zstdDecompressSync(encoded.init.body).toString()).toBe(plain.init.body)
        expect(encoded.init.body.byteLength).toBeLessThan(Buffer.byteLength(plain.init.body))
        expect(plain.init.body).toContain(image.slice(image.indexOf(",") + 1))
        const headers = new Headers(encoded.init.headers)
        expect(headers.get("content-encoding")).toBe("zstd")
        expect(headers.get("content-type")).toBe("application/json")
        expect(headers.get("authorization")).toBe("Bearer test-token")
        expect(headers.get("x-request")).toBe("kept")
        expect(headers.has("content-length")).toBe(false)
        expect(encoded.init.signal).toBe(controller.signal)
      })
    }
  }

  test("preserves encrypted reasoning after Responses sanitization", async () => {
    const opaque = "opaque-state".repeat(10_000)
    const call: Partial<Call> = {
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "retained reasoning",
              providerOptions: { openai: { itemId: "rs_test", reasoningEncryptedContent: opaque } },
            },
          ],
        },
        ...prompt,
      ],
      providerOptions: { openai: { store: false } },
    }
    const plain = await capture({ call, options: { requestCompression: false, dataCollection: "deny" } })
    const encoded = await capture({ call, options: { dataCollection: "deny" } })
    if (!(encoded.init.body instanceof Uint8Array)) throw new Error("Expected compressed request")
    const decoded = zstdDecompressSync(encoded.init.body).toString()
    expect(decoded).toBe(plain.init.body)
    const body = JSON.parse(decoded)
    expect(body.input.at(0).type).toBe("reasoning")
    expect(body.input.at(0).encrypted_content === opaque).toBe(true)
    expect(body.input.at(0).id).toBeUndefined()
    expect(body.provider.data_collection).toBe("deny")
  })

  test("keeps small requests uncompressed", async () => {
    const request = await capture({ call: { prompt: [{ role: "user", content: [{ type: "text", text: "small" }] }] } })
    expect(typeof request.init.body).toBe("string")
    expect(new Headers(request.init.headers).has("content-encoding")).toBe(false)
  })

  test("requires opt-in for custom gateways", async () => {
    const options = { baseURL: "http://127.0.0.1:1" }
    const plain = await capture({ options })
    const encoded = await capture({ options: { ...options, requestCompression: true } })
    expect(typeof plain.init.body).toBe("string")
    expect(new Headers(plain.init.headers).has("content-encoding")).toBe(false)
    if (!(encoded.init.body instanceof Uint8Array)) throw new Error("Expected compressed request")
    expect(zstdDecompressSync(encoded.init.body).toString()).toBe(plain.init.body)
  })

  test("leaves an existing content encoding unchanged", async () => {
    const request = await capture({ options: { headers: { "Content-Encoding": "identity" } } })
    expect(typeof request.init.body).toBe("string")
    expect(new Headers(request.init.headers).get("content-encoding")).toBe("identity")
  })

  test("does not send an aborted request", async () => {
    const requests: RequestInit[] = []
    const provider = createKilo({
      kilocodeToken: "test-token",
      fetch: async (_url, init) => {
        if (init) requests.push(init)
        throw new Error("Unexpected fetch")
      },
    })
    const model = provider.openai("gpt-5")
    if (typeof model === "string" || model.specificationVersion !== "v3") throw new Error("Expected V3 model")
    const controller = new AbortController()
    controller.abort()
    await expect(model.doGenerate({ prompt, abortSignal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(requests).toHaveLength(0)
  })
})
