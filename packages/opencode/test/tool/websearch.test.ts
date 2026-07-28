import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseResponse } from "../../src/tool/mcp-websearch"
import { selectWebSearchProvider, webSearchModelName, webSearchProviderLabel } from "../../src/tool/websearch"

import { webSearchEnabled } from "../../src/tool/registry"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

describe("websearch provider", () => {
  test("selects a stable provider per session", () => {
    expect(selectWebSearchProvider(SESSION_ID)).toBe(selectWebSearchProvider(SESSION_ID))
  })

  test("supports an operational override", () => {
    const original = process.env.KILO_WEBSEARCH_PROVIDER

    try {
      process.env.KILO_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.KILO_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("exa")

      // kilocode_change start - native provider-hosted web search
      process.env.KILO_WEBSEARCH_PROVIDER = "native"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("native")
      // kilocode_change end
    } finally {
      if (original === undefined) delete process.env.KILO_WEBSEARCH_PROVIDER
      else process.env.KILO_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: true, parallel: false })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: false, parallel: true })).toBe("parallel")
  })

  test("is only enabled for kilo or explicit websearch provider flags", () => {
    // kilocode_change
    expect(webSearchEnabled(ProviderV2.ID.kilo, { exa: false, parallel: false })).toBe(true) // kilocode_change
    expect(webSearchEnabled(ProviderV2.ID.opencode, { exa: false, parallel: false })).toBe(false) // kilocode_change
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: true })).toBe(true)
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    // kilocode_change start - native Anthropic label
    expect(webSearchProviderLabel("native")).toBe("Anthropic Web Search")
    // kilocode_change end
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  // kilocode_change start - native Anthropic hosted tool descriptor
  describe("nativeAnthropicWebSearchTool", () => {
    test("returns a ToolDefinition carrying the web_search_20250305 native descriptor", async () => {
      const { nativeAnthropicWebSearchTool } = await import("../../src/tool/websearch")
      const tool = nativeAnthropicWebSearchTool({ maxUses: 5 })
      expect(tool.name).toBe("web_search")
      expect(tool.native?.anthropic).toMatchObject({
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      })
    })

    test("supports allowedDomains and the newer web_search_20260209 variant", async () => {
      const { nativeAnthropicWebSearchTool } = await import("../../src/tool/websearch")
      const tool = nativeAnthropicWebSearchTool({
        variant: "web_search_20260209",
        allowedDomains: ["example.com"],
      })
      expect(tool.native?.anthropic).toMatchObject({
        type: "web_search_20260209",
        name: "web_search",
        allowed_domains: ["example.com"],
      })
    })
  })
  // kilocode_change end

  test("uses the provider API model id for Parallel analytics", () => {
    expect(
      webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  it.effect("parses plain JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(payload)
      expect(result).toBe("search results")
    }),
  )

  it.effect("parses SSE JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`event: message\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )

  it.effect("ignores non-JSON SSE data frames", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`data: [DONE]\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )
})
