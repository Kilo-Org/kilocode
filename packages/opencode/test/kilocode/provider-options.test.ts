import { describe, expect, test } from "bun:test"
import { enforceOpenRouterDataCollection } from "../../src/kilocode/provider-options"

function model(npm: string, sdk?: string) {
  return { api: { npm }, ai_sdk_provider: sdk }
}

function parse(body: BodyInit | null | undefined) {
  if (typeof body !== "string") throw new Error("Expected a JSON string body")
  const value: unknown = JSON.parse(body)
  return value
}

function enforce(body: string, npm = "@openrouter/ai-sdk-provider", sdk?: string) {
  return enforceOpenRouterDataCollection({
    model: model(npm, sdk),
    body,
    method: "POST",
    deny: true,
  })
}

describe("OpenRouter data collection policy", () => {
  test("adds deny while preserving existing routing preferences", () => {
    const body = enforce(
      JSON.stringify({
        model: "test/model",
        provider: {
          order: ["Anthropic"],
          zdr: true,
          data_collection: "allow",
        },
      }),
    )

    expect(parse(body)).toEqual({
      model: "test/model",
      provider: {
        order: ["Anthropic"],
        zdr: true,
        data_collection: "deny",
      },
    })
  })

  test("covers OpenRouter-backed Kilo Gateway models", () => {
    const implicit = enforce("{}", "@kilocode/kilo-gateway")
    const explicit = enforce("{}", "@kilocode/kilo-gateway", "openrouter")

    expect(parse(implicit)).toEqual({ provider: { data_collection: "deny" } })
    expect(parse(explicit)).toEqual({ provider: { data_collection: "deny" } })
  })

  test("does not rewrite native Kilo Gateway model requests", () => {
    for (const sdk of ["alibaba", "anthropic", "mistral", "openai", "openai-compatible"]) {
      const body = "{}"
      expect(enforce(body, "@kilocode/kilo-gateway", sdk)).toBe(body)
    }
  })

  test("does not rewrite requests when the policy is disabled", () => {
    const body = JSON.stringify({ provider: { data_collection: "allow" } })
    expect(
      enforceOpenRouterDataCollection({
        model: model("@openrouter/ai-sdk-provider"),
        body,
        method: "POST",
        deny: false,
      }),
    ).toBe(body)
  })

  test("does not rewrite non-OpenRouter, non-POST, or invalid requests", () => {
    const body = "{}"
    expect(enforce(body, "@ai-sdk/anthropic")).toBe(body)
    expect(
      enforceOpenRouterDataCollection({
        model: model("@openrouter/ai-sdk-provider"),
        body,
        method: "GET",
        deny: true,
      }),
    ).toBe(body)
    expect(enforce("not json")).toBe("not json")
  })

  test("replaces malformed provider routing values", () => {
    expect(parse(enforce(JSON.stringify({ provider: null })))).toEqual({
      provider: { data_collection: "deny" },
    })
    expect(parse(enforce(JSON.stringify({ provider: [] })))).toEqual({
      provider: { data_collection: "deny" },
    })
  })
})
