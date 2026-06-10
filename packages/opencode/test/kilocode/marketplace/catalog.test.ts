import { afterEach, describe, expect, it } from "bun:test"
import * as Catalog from "@/kilocode/marketplace/catalog"

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
  Catalog.clear()
})

function stub(fn: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => fn(String(input))) as typeof fetch
}

describe("marketplace catalog", () => {
  it("parses JSON and YAML catalog responses", async () => {
    stub((url) => {
      if (url.endsWith("/agents")) return new Response(JSON.stringify({ items: [{ id: "helper", name: "Helper", description: "", content: { mode: "primary", description: "", prompt: "x" } }] }))
      if (url.endsWith("/mcps")) return new Response("items:\n  - id: memory\n    name: Memory\n    description: ''\n    url: https://example.com\n    content: '{\"command\":\"memory\"}'\n")
      return new Response(JSON.stringify({ items: [{ id: "code-review", description: "Review code", category: "quality", githubUrl: "https://example.com", content: "https://example.com/skill.tgz" }] }))
    })

    const out = await Catalog.all()

    expect(out.errors).toEqual([])
    expect(out.items.map((item) => `${item.type}:${item.id}`)).toEqual(["agent:helper", "mcp:memory", "skill:code-review"])
    expect(out.items.find((item) => item.type === "skill")).toMatchObject({
      displayName: "Code Review",
      displayCategory: "Quality",
    })
  })

  it("caches successful category fetches", async () => {
    const hits = { agents: 0, mcps: 0, skills: 0 }
    stub((url) => {
      if (url.endsWith("/agents")) hits.agents++
      if (url.endsWith("/mcps")) hits.mcps++
      if (url.endsWith("/skills")) hits.skills++
      return new Response(JSON.stringify({ items: [] }))
    })

    await Catalog.all()
    await Catalog.all()

    expect(hits).toEqual({ agents: 1, mcps: 1, skills: 1 })
  })

  it("returns successful categories when one category fails", async () => {
    stub((url) => {
      if (url.endsWith("/mcps")) return new Response("nope", { status: 500, statusText: "broken" })
      return new Response(JSON.stringify({ items: [] }))
    })

    const out = await Catalog.all()

    expect(out.items).toEqual([])
    expect(out.errors).toEqual(["Failed to fetch mcps: HTTP 500: broken"])
  })
})
