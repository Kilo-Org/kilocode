import { describe, expect, test } from "bun:test"
import { clearCache, fetchAll, kebabToTitleCase, parseResponse } from "../../src/kilocode/marketplace/api"

function response(body: string, status = 200) {
  return new Response(body, { status, statusText: status === 200 ? "OK" : "Bad" })
}

describe("marketplace catalog api", () => {
  test("parses json and yaml marketplace responses", () => {
    expect(parseResponse('{"items":[{"id":"x"}]}')).toEqual({ items: [{ id: "x" }] })
    expect(parseResponse("items:\n  - id: x\n")).toEqual({ items: [{ id: "x" }] })
  })

  test("fetches and transforms all marketplace item types", async () => {
    clearCache()
    const calls: string[] = []
    const fake = async (url: string | URL | Request) => {
      const raw = String(url)
      calls.push(raw)
      if (raw.endsWith("/agents")) {
        return response('{"items":[{"id":"reviewer","name":"Reviewer","description":"Review","category":"dev","content":{"mode":"all","description":"Review","prompt":"Review"}}]}')
      }
      if (raw.endsWith("/mcps")) {
        return response('{"items":[{"id":"memory","name":"Memory","description":"Remember","category":"dev","url":"https://example.com","content":"{}"}]}')
      }
      return response("items:\n  - id: campaign-writer\n    description: Write campaigns\n    category: marketing\n    githubUrl: https://example.com\n    content: https://example.com/skill.tar.gz\n")
    }

    const out = await fetchAll({ fetch: fake as typeof fetch, baseUrl: "https://market.test" })
    expect(out.errors).toEqual([])
    expect(out.items.map((item) => `${item.type}:${item.id}`).sort()).toEqual([
      "agent:reviewer",
      "mcp:memory",
      "skill:campaign-writer",
    ])
    const skill = out.items.find((item) => item.type === "skill")
    expect(skill?.name).toBe("Campaign Writer")
    expect(skill?.category).toBe("marketing")

    await fetchAll({ fetch: fake as typeof fetch, baseUrl: "https://market.test" })
    expect(calls).toHaveLength(3)
  })

  test("aggregates per-kind fetch errors", async () => {
    clearCache()
    const fake = async (url: string | URL | Request) => {
      if (String(url).endsWith("/mcps")) return response("no", 500)
      return response('{"items":[]}')
    }

    const out = await fetchAll({ fetch: fake as typeof fetch, baseUrl: "https://error.test" })
    expect(out.items).toEqual([])
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0]).toContain("Failed to fetch mcps")
  })

  test("formats kebab ids for skill display names", () => {
    expect(kebabToTitleCase("campaign-writer")).toBe("Campaign Writer")
  })
})
