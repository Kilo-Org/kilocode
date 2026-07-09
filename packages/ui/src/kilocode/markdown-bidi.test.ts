import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const markdownPath = path.join(root, "components/markdown.tsx")
const markedPath = path.join(root, "context/marked.tsx")

describe("Markdown bidirectional rendering contract", () => {
  test("sets one auto direction on the markdown root and isolates code direction", () => {
    const markdown = fs.readFileSync(markdownPath, "utf-8")
    const marked = fs.readFileSync(markedPath, "utf-8")

    expect(markdown).toMatch(/data-component="markdown"[\s\S]*dir=\{"auto" \/\* kilocode_change \*\/\}/)
    expect(marked).toContain('<code class="file-link" dir="auto"')
    expect(marked).toContain('<code dir="auto">')
    expect(marked).toContain('<pre dir="auto"><code')
  })
})
