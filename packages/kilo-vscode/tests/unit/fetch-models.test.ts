import { describe, expect, it } from "bun:test"
import { fetchOpenAIModels, fetchProviderModels, FetchModelsError } from "../../src/shared/fetch-models"

type Handler = (req: Request) => Response | Promise<Response>

async function withServer(handler: Handler, run: (url: string) => Promise<void>) {
  const server = Bun.serve({
    port: 0,
    fetch: handler,
  })
  try {
    await run(server.url.origin)
  } finally {
    server.stop(true)
  }
}

describe("fetchOpenAIModels", () => {
  it("parses OpenAI-compatible model lists", async () => {
    await withServer(
      () =>
        Response.json({
          data: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "  gpt-4o  " }, { id: "o3-mini" }],
        }),
      async (url) => {
        const models = await fetchOpenAIModels({ baseURL: `${url}/v1`, apiKey: "sk-test" })
        expect(models).toEqual([
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "o3-mini", name: "o3-mini" },
        ])
      },
    )
  })

  it("marks 401 as auth errors", async () => {
    await withServer(
      () => new Response("nope", { status: 401 }),
      async (url) => {
        try {
          await fetchOpenAIModels({ baseURL: url, apiKey: "bad" })
          throw new Error("expected fetch to fail")
        } catch (err) {
          expect(err).toBeInstanceOf(FetchModelsError)
          expect((err as FetchModelsError).auth).toBe(true)
        }
      },
    )
  })
})

describe("fetchProviderModels", () => {
  it("uses Anthropic headers and display names", async () => {
    const seen: string[] = []
    await withServer(
      (req) => {
        seen.push(req.headers.get("x-api-key") ?? "")
        seen.push(req.headers.get("anthropic-version") ?? "")
        seen.push(req.headers.get("authorization") ?? "")
        return Response.json({
          data: [{ id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" }],
          has_more: false,
        })
      },
      async (url) => {
        const models = await fetchProviderModels({
          baseURL: `${url}/v1`,
          apiKey: "sk-ant",
          npm: "@ai-sdk/anthropic",
        })
        expect(models).toEqual([{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }])
        expect(seen).toEqual(["sk-ant", "2023-06-01", "Bearer sk-ant"])
      },
    )
  })

  it("pages through Anthropic model lists", async () => {
    await withServer(
      (req) => {
        const after = new URL(req.url).searchParams.get("after_id")
        if (!after) {
          return Response.json({
            data: [{ id: "claude-opus-4-6", display_name: "Claude Opus 4.6" }],
            has_more: true,
            last_id: "claude-opus-4-6",
          })
        }
        return Response.json({
          data: [{ id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }],
          has_more: false,
          last_id: "claude-haiku-4-5",
        })
      },
      async (url) => {
        const models = await fetchProviderModels({
          baseURL: url,
          apiKey: "sk-ant",
          npm: "@ai-sdk/anthropic",
        })
        expect(models).toEqual([
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
          { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
        ])
      },
    )
  })

  it("falls back to OpenAI-compatible lists for Anthropic packages", async () => {
    let calls = 0
    await withServer(
      (req) => {
        calls++
        if (req.headers.has("x-api-key")) return new Response("nope", { status: 404 })
        return Response.json({ data: [{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" }] })
      },
      async (url) => {
        const models = await fetchProviderModels({
          baseURL: url,
          apiKey: "sk-or",
          npm: "@ai-sdk/anthropic",
        })
        expect(models).toEqual([{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" }])
        expect(calls).toBe(2)
      },
    )
  })
})
