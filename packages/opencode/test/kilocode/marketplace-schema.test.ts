import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MarketplaceListResult } from "../../src/kilocode/marketplace/schema"

const encode = Schema.encodeUnknownSync(MarketplaceListResult)

const mcp = (extra: Record<string, unknown>) => ({
  type: "mcp",
  id: "linear",
  name: "Linear",
  description: "Linear MCP",
  category: "productivity",
  url: "https://linear.app",
  ...extra,
})

describe("marketplace catalog OAuth metadata", () => {
  test("method and item auth metadata reach clients through the list API", () => {
    const result = encode({
      items: [
        mcp({
          content: [
            {
              id: "hosted",
              name: "Hosted",
              content: '{"url":"https://mcp.linear.app/mcp"}',
              oauthRequirement: "required",
              authHandler: "kilo",
            },
          ],
        }),
        { ...mcp({ content: '{"url":"https://x.test/mcp"}', oauthRequirement: "optional" }), id: "single" },
      ],
      installed: { project: {}, global: {} },
    })

    expect(result.items[0]).toMatchObject({
      content: [
        {
          id: "hosted",
          name: "Hosted",
          content: '{"url":"https://mcp.linear.app/mcp"}',
          oauthRequirement: "required",
          authHandler: "kilo",
        },
      ],
    })
    expect(result.items[1]).toMatchObject({ id: "single", oauthRequirement: "optional" })
  })

  test("a requirement value this build does not know never rejects the catalog", () => {
    expect(() =>
      encode({
        items: [mcp({ content: '{"url":"https://x.test/mcp"}', oauthRequirement: "per_tenant" })],
        installed: { project: {}, global: {} },
      }),
    ).not.toThrow()
  })

  test("entries without auth metadata are unchanged", () => {
    const result = encode({
      items: [mcp({ content: '{"url":"https://x.test/mcp"}' })],
      installed: { project: {}, global: {} },
    })
    expect(result.items[0]).not.toHaveProperty("oauthRequirement")
    expect(result.items[0]).not.toHaveProperty("authHandler")
  })
})
