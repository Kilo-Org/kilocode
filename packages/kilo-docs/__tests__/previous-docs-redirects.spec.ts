import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import redirects from "../previous-docs-redirects.js"

interface Redirect {
  source: string
  destination: string
  basePath?: boolean
  permanent?: boolean
}

const entries = redirects as Redirect[]
const pages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages")
const archive = "https://github.com/Kilo-Org/kilocode-legacy/blob/main/docs/legacy-ides/"

describe("previous-docs-redirects", () => {
  it("has unique sources", () => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()

    for (const redirect of entries) {
      if (seen.has(redirect.source)) duplicates.add(redirect.source)
      seen.add(redirect.source)
    }

    expect([...duplicates]).toEqual([])
  })

  it("has valid redirect objects", () => {
    for (const redirect of entries) {
      expect(redirect.source).toMatch(/^\//)
      expect(redirect.destination).toMatch(/^(?:\/|https:\/\/)/)
      expect(redirect.basePath).toBe(false)
      expect(redirect.permanent).toBe(true)
    }
  })

  it("preserves wildcard parameters", () => {
    for (const redirect of entries) {
      const params = redirect.source.match(/:[A-Za-z]+\*/g) ?? []
      for (const param of params) expect(redirect.destination).toContain(param)
    }
  })

  it("has no direct or indirect cycles", () => {
    const exact = new Map(
      entries
        .filter((redirect) => !redirect.source.includes(":") && redirect.source !== redirect.destination)
        .map((redirect) => [redirect.source, redirect.destination]),
    )

    for (const source of exact.keys()) {
      const seen = new Set([source])
      const chain = [source]
      let current = source

      while (exact.has(current)) {
        current = exact.get(current)!
        chain.push(current)
        expect(seen.has(current), `Redirect cycle: ${chain.join(" -> ")}`).toBe(false)
        seen.add(current)
      }
    }
  })

  it("points internal destinations at existing pages", () => {
    for (const redirect of entries) {
      const destination = redirect.destination.split("#", 1)[0]
      if (!destination.startsWith("/docs") || destination.includes(":")) continue

      const route = destination.replace(/^\/docs\/?/, "")
      const candidates = route
        ? [path.join(pages, `${route}.md`), path.join(pages, route, "index.md")]
        : [path.join(pages, "index.md")]
      expect(candidates.some((candidate) => fs.existsSync(candidate)), `${redirect.source} -> ${destination}`).toBe(true)
    }
  })

  it("redirects removed legacy routes directly to the archive", () => {
    const expected = new Map([
      [
        "/docs/getting-started/settings/auto-cleanup",
        `${archive}getting-started/settings/auto-cleanup.md`,
      ],
      ["/docs/advanced-usage/large-projects", `${archive}customize/context/large-projects.md`],
      ["/docs/features/tools/read-file", `${archive}automate/tools/read-file.md`],
      ["/docs/providers/claude-code", `${archive}ai-providers/claude-code.md`],
      ["/docs/jetbrains-troubleshooting", `${archive}getting-started/troubleshooting/jetbrains.md`],
    ])
    const actual = new Map(entries.map((redirect) => [redirect.source, redirect.destination]))

    for (const [source, destination] of expected) expect(actual.get(source)).toBe(destination)
  })

  it("keeps aliases for current pages on the active docs site", () => {
    const expected = new Map([
      ["/docs/providers", "/docs/ai-providers"],
      ["/docs/providers/:path*", "/docs/ai-providers/:path*"],
      ["/docs/providers/openai-codex", "/docs/ai-providers/openai-chatgpt-plus-pro"],
      ["/docs/basic-usage/using-modes", "/docs/code-with-ai/agents/using-agents"],
      ["/docs/features/slash-commands", "/docs/customize/workflows"],
      ["/docs/features/slash-commands/workflows", "/docs/customize/workflows"],
      ["/docs/features/custom-instructions", "/docs/customize/custom-instructions"],
      ["/docs/advanced-usage/custom-instructions", "/docs/customize/custom-instructions"],
      ["/docs/advanced-usage/custom-rules", "/docs/customize/custom-rules"],
      ["/docs/features/skills", "/docs/customize/skills"],
      ["/docs/features/shell-integration", "/docs/automate/extending/shell-integration"],
    ])
    const actual = new Map(entries.map((redirect) => [redirect.source, redirect.destination]))

    for (const [source, destination] of expected) expect(actual.get(source)).toBe(destination)
  })

  it("orders exact provider routes before the provider wildcard", () => {
    const wildcard = entries.findIndex((redirect) => redirect.source === "/docs/providers/:path*")
    const exact = [
      "/docs/providers",
      "/docs/providers/claude-code",
      "/docs/providers/glama",
      "/docs/providers/human-relay",
      "/docs/providers/virtual-quota-fallback",
      "/docs/providers/vscode-lm",
      "/docs/providers/openai-codex",
    ]

    expect(wildcard).toBeGreaterThan(-1)
    for (const source of exact) {
      const index = entries.findIndex((redirect) => redirect.source === source)
      expect(index, source).toBeGreaterThan(-1)
      expect(index, source).toBeLessThan(wildcard)
    }
  })

  it("uses well-formed GitHub Markdown destinations", () => {
    for (const redirect of entries) {
      if (!redirect.destination.startsWith(archive)) continue
      expect(redirect.destination).toMatch(/\.md(?:#.*)?$/)
    }
  })
})
