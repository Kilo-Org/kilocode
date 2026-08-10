import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  FetchModelsError,
  fetchAnthropicModels,
  fetchCustomModels,
  fetchOpenAIModels,
} from "../../src/shared/fetch-models"

describe("fetch-models", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("fetchOpenAIModels", () => {
    it("fetches and parses models from OpenAI compatible endpoint", async () => {
      let requestedURL = ""
      let requestedHeaders: Record<string, string> = {}

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedURL = url.toString()
        requestedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini", name: "GPT-4o Mini" },
              { id: "gpt-4o", name: "GPT-4o" },
              { id: "gpt-4o" }, // duplicate
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }) as typeof fetch

      const result = await fetchOpenAIModels({
        baseURL: "https://api.openai.com/v1/",
        apiKey: "sk-test-key",
        headers: { "X-Custom": "custom-val" },
      })

      expect(requestedURL).toBe("https://api.openai.com/v1/models")
      expect(requestedHeaders["Authorization"]).toBe("Bearer sk-test-key")
      expect(requestedHeaders["X-Custom"]).toBe("custom-val")
      expect(result).toEqual([
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      ])
    })

    it("throws FetchModelsError on HTTP error with auth detection", async () => {
      globalThis.fetch = (async () => {
        return new Response("Unauthorized", { status: 401 })
      }) as typeof fetch

      let caught: unknown
      try {
        await fetchOpenAIModels({ baseURL: "https://api.example.com/v1", apiKey: "bad-key" })
      } catch (err) {
        caught = err
      }

      expect(caught instanceof FetchModelsError).toBe(true)
      expect((caught as FetchModelsError).auth).toBe(true)
      expect((caught as FetchModelsError).status).toBe(401)
    })
  })

  describe("fetchAnthropicModels", () => {
    it("fetches and parses models from Anthropic API with display_name", async () => {
      let requestedURL = ""
      let requestedHeaders: Record<string, string> = {}

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedURL = url.toString()
        requestedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(
          JSON.stringify({
            data: [
              { id: "claude-3-7-sonnet-20250219", display_name: "Claude 3.7 Sonnet" },
              { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }) as typeof fetch

      const result = await fetchAnthropicModels({
        baseURL: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        headers: { "anthropic-beta": "output-128k-2025-02-19" },
      })

      expect(requestedURL).toBe("https://api.anthropic.com/v1/models?limit=1000")
      expect(requestedHeaders["x-api-key"]).toBe("sk-ant-test")
      expect(requestedHeaders["anthropic-version"]).toBe("2023-06-01")
      expect(requestedHeaders["anthropic-beta"]).toBe("output-128k-2025-02-19")
      expect(result).toEqual([
        { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
        { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
      ])
    })

    it("normalizes /v1 and /messages in base URLs", async () => {
      let requestedURL = ""

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedURL = url.toString()
        return new Response(JSON.stringify({ data: [{ id: "claude-3-haiku" }] }), { status: 200 })
      }) as typeof fetch

      await fetchAnthropicModels({ baseURL: "https://custom-proxy.com/v1/messages" })
      expect(requestedURL).toBe("https://custom-proxy.com/v1/models?limit=1000")
    })

    it("extracts error message from Anthropic error response", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "authentication_error",
              message: "invalid x-api-key",
            },
          }),
          { status: 401 },
        )
      }) as typeof fetch

      let caught: unknown
      try {
        await fetchAnthropicModels({ baseURL: "https://api.anthropic.com", apiKey: "bad" })
      } catch (err) {
        caught = err
      }

      expect(caught instanceof FetchModelsError).toBe(true)
      expect((caught as FetchModelsError).message).toBe("invalid x-api-key")
      expect((caught as FetchModelsError).auth).toBe(true)
    })
  })

  describe("fetchCustomModels", () => {
    it("routes @ai-sdk/anthropic to fetchAnthropicModels", async () => {
      let requestedHeaders: Record<string, string> = {}

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requestedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({ data: [{ id: "claude-3-5-sonnet" }] }), { status: 200 })
      }) as typeof fetch

      await fetchCustomModels({
        npm: "@ai-sdk/anthropic",
        baseURL: "https://api.anthropic.com",
        apiKey: "ant-key",
      })

      expect(requestedHeaders["x-api-key"]).toBe("ant-key")
      expect(requestedHeaders["anthropic-version"]).toBe("2023-06-01")
    })

    it("routes other packages to fetchOpenAIModels", async () => {
      let requestedHeaders: Record<string, string> = {}

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requestedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 })
      }) as typeof fetch

      await fetchCustomModels({
        npm: "@ai-sdk/openai-compatible",
        baseURL: "https://api.openai.com/v1",
        apiKey: "oai-key",
      })

      expect(requestedHeaders["Authorization"]).toBe("Bearer oai-key")
    })
  })
})
