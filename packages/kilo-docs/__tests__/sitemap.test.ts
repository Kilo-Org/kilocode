import { describe, it, expect } from "vitest"
import { buildSitemapXml } from "../pages/api/sitemap.xml"

describe("sitemap.xml", () => {
  it("produces valid XML with urlset root", () => {
    const xml = buildSitemapXml()
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain("</urlset>")
  })

  it("all <loc> values start with https://kilo.ai/docs", () => {
    const xml = buildSitemapXml()
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBeGreaterThan(0)
    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\/kilo\.ai\/docs/)
    }
  })

  it("includes the docs root URL", () => {
    const xml = buildSitemapXml()
    expect(xml).toContain("<loc>https://kilo.ai/docs</loc>")
  })

  it("includes representative current product pages", () => {
    const xml = buildSitemapXml()
    expect(xml).toContain("https://kilo.ai/docs/getting-started/installing")
    expect(xml).toContain("https://kilo.ai/docs/code-with-ai/platforms/vscode")
    expect(xml).toContain("https://kilo.ai/docs/code-with-ai/platforms/vscode/whats-new")
    expect(xml).toContain("https://kilo.ai/docs/code-with-ai/platforms/cli")
    expect(xml).toContain("https://kilo.ai/docs/code-with-ai/platforms/jetbrains")
    expect(xml).toContain("https://kilo.ai/docs/automate/tools")
    expect(xml).toContain("https://kilo.ai/docs/automate/tools/semantic-search")
  })

  it("excludes removed legacy product pages", () => {
    const xml = buildSitemapXml()
    const removed = [
      "/getting-started/settings/auto-cleanup",
      "/getting-started/settings/system-notifications",
      "/getting-started/faq/known-issues",
      "/customize/context/large-projects",
      "/automate/extending/auto-launch",
      "/automate/tools/read-file",
      "/code-with-ai/features/fast-edits",
      "/ai-providers/vscode-lm",
    ]

    for (const route of removed) expect(xml).not.toContain(`https://kilo.ai/docs${route}`)
  })

  it("has no duplicate <loc> entries", () => {
    const xml = buildSitemapXml()
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
    const unique = new Set(locs)
    expect(locs.length).toBe(unique.size)
  })
})
