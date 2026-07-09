import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createMarkedParser } from "../context/marked"

const root = path.resolve(import.meta.dir, "..")
const markdownPath = path.join(root, "components/markdown.tsx")

describe("Markdown bidirectional rendering contract", () => {
  test("sets one auto direction on the markdown root", () => {
    const markdown = fs.readFileSync(markdownPath, "utf-8")

    expect(markdown).toMatch(/data-component="markdown"[\s\S]*dir=\{"auto" \/\* kilocode_change \*\/\}/)
  })

  test("renders code, pre, and math with isolated direction", async () => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(
      parser.parse(
        ["متن با `inlineCode`", "", "```ts", "const value = 1", "```", "", "$$", "a = b + c", "$$"].join("\n"),
      ),
    )

    expect(html).toContain('<code dir="auto">inlineCode</code>')
    expect(html).toContain('<pre dir="auto"><code class="language-ts" data-lang="ts">')
    expect(html).toContain("const value = 1")
    expect(html.match(/<span dir="auto"><span class="katex/g)?.length).toBe(1)
  })
})
