import { afterEach, describe, expect, it } from "bun:test"
import { collectModels, fetchOpenAIModels, FetchModelsError } from "../../src/shared/fetch-models"

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("collectModels", () => {
  it("reads OpenAI id/name pairs and skips duplicates", () => {
    expect(
      collectModels([
        { id: "gpt-4o", name: "GPT-4o" },
        { id: " gpt-4o ", name: "Dup" },
        { id: "o3", name: "o3" },
        { id: "" },
        null,
      ]),
    ).toEqual([
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "o3", name: "o3" },
    ])
  })

  it("prefers Anthropic display_name", () => {
    expect(collectModels([{ id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" }])).toEqual([
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    ])
  })
})

describe("fetchOpenAIModels", () => {
  it("calls the OpenAI-compatible /models endpoint with a bearer token", async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) })
      return json({ data: [{ id: "gpt-4o", name: "GPT-4o" }] })
    }

    const models = await fetchOpenAIModels({
      baseURL: "https://api.openai.com/v1/",
      apiKey: "sk-test",
    })

    expect(models).toEqual([{ id: "gpt-4o", name: "GPT-4o" }])
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models")
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer sk-test")
  })

  it("fetches Anthropic models with x-api-key and paginates", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes("after_id=page-1")) {
        return json({
          data: [{ id: "claude-opus-4-20250514", display_name: "Claude Opus 4" }],
          has_more: false,
          last_id: "page-2",
        })
      }
      return json({
        data: [{ id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" }],
        has_more: true,
        last_id: "page-1",
      })
    }

    const models = await fetchOpenAIModels({
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test",
      npm: "@ai-sdk/anthropic",
    })

    expect(calls[0]).toContain("https://api.anthropic.com/v1/models?")
    expect(calls[1]).toContain("after_id=page-1")
    expect(models.map((m) => m.id)).toEqual(["claude-opus-4-20250514", "claude-sonnet-4-20250514"])

    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get("x-api-key")).toBe("sk-ant-test")
      expect(headers.get("anthropic-version")).toBe("2023-06-01")
      expect(headers.get("Authorization")).toBeNull()
      return json({ data: [], has_more: false })
    }

    await fetchOpenAIModels({
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test",
      npm: "@ai-sdk/anthropic",
    })
  })

  it("marks 401 responses as auth errors", async () => {
    globalThis.fetch = async () => json({ error: "nope" }, 401)
    try {
      await fetchOpenAIModels({ baseURL: "https://example.com/v1", apiKey: "bad" })
      throw new Error("expected failure")
    } catch (err) {
      expect(err).toBeInstanceOf(FetchModelsError)
      expect((err as FetchModelsError).auth).toBe(true)
    }
  })
})
