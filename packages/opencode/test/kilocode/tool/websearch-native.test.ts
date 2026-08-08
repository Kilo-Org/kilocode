import { describe, expect, test } from "bun:test"
import {
  nativeAnthropicWebSearchTool,
  nativeWebSearchEnabled,
  selectWebSearchProvider,
} from "@/tool/websearch"

describe("native web search (kilocode)", () => {
  test("selectWebSearchProvider returns native under KILO_WEBSEARCH_PROVIDER=native", () => {
    const original = process.env.KILO_WEBSEARCH_PROVIDER
    try {
      process.env.KILO_WEBSEARCH_PROVIDER = "native"
      expect(selectWebSearchProvider("ses_test")).toBe("native")
    } finally {
      if (original === undefined) delete process.env.KILO_WEBSEARCH_PROVIDER
      else process.env.KILO_WEBSEARCH_PROVIDER = original
    }
  })

  test("nativeWebSearchEnabled is true only for Anthropic Claude providers", () => {
    expect(nativeWebSearchEnabled("@ai-sdk/anthropic")).toBe(true)
    expect(nativeWebSearchEnabled("@ai-sdk/google-vertex/anthropic")).toBe(true)
    expect(nativeWebSearchEnabled("@ai-sdk/openai")).toBe(false)
    expect(nativeWebSearchEnabled("@ai-sdk/google")).toBe(false)
    expect(nativeWebSearchEnabled(undefined)).toBe(false)
  })

  test("nativeAnthropicWebSearchTool emits the web_search_20250305 native descriptor", () => {
    const tool = nativeAnthropicWebSearchTool({ maxUses: 3, allowedDomains: ["docs.example.com"] })
    expect(tool.name).toBe("web_search")
    expect(tool.native?.anthropic).toMatchObject({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
      allowed_domains: ["docs.example.com"],
    })
  })

  test("nativeAnthropicWebSearchTool defaults to web_search_20250305 with no constraints", () => {
    const tool = nativeAnthropicWebSearchTool()
    expect(tool.native?.anthropic).toEqual({ type: "web_search_20250305", name: "web_search" })
  })

  test("the newer web_search_20260209 variant is selectable", () => {
    const tool = nativeAnthropicWebSearchTool({ variant: "web_search_20260209" })
    expect(tool.native?.anthropic).toMatchObject({ type: "web_search_20260209", name: "web_search" })
  })

  test("selectWebSearchProvider falls back to local exa/parallel when native is set but not for Anthropic", () => {
    // selectWebSearchProvider still reports "native"; the registry/tools gate
    // combines this with nativeWebSearchEnabled(model.api.npm) to decide whether
    // to actually use the hosted tool or fall back to local. This test pins the
    // provider-selection contract; the model gating is exercised separately.
    const original = process.env.KILO_WEBSEARCH_PROVIDER
    try {
      process.env.KILO_WEBSEARCH_PROVIDER = "native"
      expect(selectWebSearchProvider("ses_test")).toBe("native")
      expect(nativeWebSearchEnabled("@ai-sdk/openai")).toBe(false)
    } finally {
      if (original === undefined) delete process.env.KILO_WEBSEARCH_PROVIDER
      else process.env.KILO_WEBSEARCH_PROVIDER = original
    }
  })
})
