import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pages = path.join(root, "pages")
const images = path.join(root, "public/img")
const removed = [
  "getting-started/settings/auto-cleanup",
  "getting-started/settings/system-notifications",
  "getting-started/faq/known-issues",
  "customize/context/large-projects",
  "automate/extending/auto-launch",
  "code-with-ai/features/fast-edits",
  "ai-providers/claude-code",
  "ai-providers/glama",
  "ai-providers/human-relay",
  "ai-providers/virtual-quota-fallback",
  "ai-providers/vscode-lm",
  "automate/tools/access-mcp-resource",
  "automate/tools/apply-diff",
  "automate/tools/ask-followup-question",
  "automate/tools/attempt-completion",
  "automate/tools/browser-action",
  "automate/tools/delete-file",
  "automate/tools/execute-command",
  "automate/tools/list-code-definition-names",
  "automate/tools/list-files",
  "automate/tools/new-task",
  "automate/tools/read-file",
  "automate/tools/search-files",
  "automate/tools/switch-mode",
  "automate/tools/update-todo-list",
  "automate/tools/use-mcp-tool",
  "automate/tools/write-to-file",
]

function markdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) return markdown(target)
    return entry.name.endsWith(".md") ? [target] : []
  })
}

const files = markdown(pages)

describe("active documentation integrity", () => {
  it("contains no legacy platform metadata or tab labels", () => {
    const violations = files.flatMap((file) => {
      const content = fs.readFileSync(file, "utf8")
      return /platform:\s*["']?legacy|VS\s?Code \(Legacy\)|VSCode \(Legacy\)/.test(content)
        ? [path.relative(root, file)]
        : []
    })

    expect(violations).toEqual([])
  })

  it("does not retain removed legacy page files", () => {
    for (const route of removed) {
      expect(fs.existsSync(path.join(pages, `${route}.md`)), route).toBe(false)
      expect(fs.existsSync(path.join(pages, route, "index.md")), route).toBe(false)
    }
  })

  it("does not link to removed legacy routes", () => {
    const violations: string[] = []
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8")
      for (const route of removed) {
        if (content.includes(`/docs/${route}`)) violations.push(`${path.relative(root, file)} -> ${route}`)
      }
    }

    expect(violations).toEqual([])
  })

  it("has balanced tab and callout tags", () => {
    const paired = new Set(["callout", "tab", "tabs"])
    const violations: string[] = []

    for (const file of files) {
      const stack: { tag: string; line: number }[] = []
      const lines = fs.readFileSync(file, "utf8").split("\n")
      lines.forEach((line, index) => {
        const tag = line.trim().match(/^\{% (\/?)([a-z-]+)(?: [^%]*)?%\}$/)
        if (!tag || !paired.has(tag[2]) || line.trim().endsWith("/%}")) return
        if (!tag[1]) {
          stack.push({ tag: tag[2], line: index + 1 })
          return
        }

        const open = stack.pop()
        if (!open || open.tag !== tag[2]) {
          violations.push(`${path.relative(root, file)}:${index + 1} closes ${tag[2]} without a matching opener`)
        }
      })

      for (const open of stack) {
        violations.push(`${path.relative(root, file)}:${open.line} leaves ${open.tag} unclosed`)
      }
    }

    expect(violations).toEqual([])
  })

  it("preserves current IDE migration anchors", () => {
    const jetbrains = fs.readFileSync(path.join(root, "markdoc/partials/install-jetbrains.md"), "utf8")
    expect(jetbrains).toContain("{% #jetbrains-early-access %}")
    expect(fs.existsSync(path.join(pages, "code-with-ai/platforms/vscode/whats-new.md"))).toBe(true)
  })

  it("explains when indexed context is selected by agents", () => {
    const indexing = fs.readFileSync(path.join(pages, "customize/context/codebase-indexing.md"), "utf8")
    const search = fs.readFileSync(path.join(pages, "automate/tools/semantic-search.md"), "utf8")

    expect(indexing).toContain("Indexing makes `semantic_search` available")
    expect(indexing).toContain("does not force Kilo Code to use that tool for every codebase question")
    expect(indexing).toContain("[AGENTS.md](/docs/customize/agents-md)")
    expect(search).toContain("LanceDB or Qdrant")
    expect(search).toContain("prefer `semantic_search` for broad codebase questions")
  })

  it("references existing local images, including PNG files", () => {
    const missing = new Set<string>()
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "")
      for (const match of content.matchAll(/\/docs\/img\/([^\s"')]+)/g)) {
        const image = decodeURIComponent(match[1])
        if (!fs.existsSync(path.join(images, image))) missing.add(`${path.relative(root, file)} -> ${image}`)
      }
    }

    expect([...missing]).toEqual([])
  })
})
