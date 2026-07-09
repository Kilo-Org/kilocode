import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createMarkedParser } from "../context/marked"
import { fnv1a } from "../context/marked"
import { update } from "./markdown-stream-highlight"

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

  test("updates streaming code highlight in place while preserving direction", () => {
    class Code {
      constructor(readonly textContent: string) {}
    }

    class Pre {
      isConnected = true
      scrollLeft = 0
      childNodes: Code[] = []
      private attrs = new Map<string, string>()

      getAttribute(name: string) {
        return this.attrs.get(name) ?? null
      }

      setAttribute(name: string, value: string) {
        this.attrs.set(name, value)
      }

      removeAttribute(name: string) {
        this.attrs.delete(name)
      }

      hasAttribute(name: string) {
        return this.attrs.has(name)
      }

      getAttributeNames() {
        return Array.from(this.attrs.keys())
      }

      get attributes() {
        return Array.from(this.attrs, ([name, value]) => ({ name, value }))
      }

      get className() {
        return this.getAttribute("class") ?? ""
      }

      get textContent() {
        return this.childNodes.map((node) => node.textContent).join("")
      }

      set innerHTML(html: string) {
        const text = html.match(/<code[^>]*>([\s\S]*)<\/code>/)?.[1] ?? ""
        this.childNodes = [new Code(text)]
      }

      replaceChildren(...nodes: Code[]) {
        this.childNodes = nodes
      }
    }

    class Div {
      firstElementChild: Pre | null = null

      set innerHTML(html: string) {
        const pre = new Pre()
        for (const match of html.matchAll(/\s([a-z-]+)="([^"]*)"/g)) {
          pre.setAttribute(match[1]!, match[2]!)
        }
        pre.innerHTML = html
        this.firstElementChild = pre
      }
    }

    const scope = globalThis as typeof globalThis & {
      document: Document
      HTMLPreElement: typeof HTMLPreElement
    }
    const doc = scope.document
    const elem = scope.HTMLPreElement
    scope.document = {
      createElement: (tag: string) => (tag === "pre" ? new Pre() : new Div()),
    } as unknown as Document
    scope.HTMLPreElement = Pre as unknown as typeof HTMLPreElement

    const pre = document.createElement("pre")
    const code = "const value = 1"
    pre.setAttribute("dir", "auto")
    pre.setAttribute("data-old", "removed")
    pre.scrollLeft = 24
    pre.innerHTML = `<code data-lang="ts">${code}</code>`

    try {
      update(pre, `<pre class="shiki" tabindex="0"><code>${code}</code></pre>`, code)

      expect(pre.getAttribute("dir")).toBe("auto")
      expect(pre.className).toBe("shiki")
      expect(pre.getAttribute("tabindex")).toBe("0")
      expect(pre.hasAttribute("data-old")).toBe(false)
      expect(pre.getAttribute("data-source-hash")).toBe(fnv1a(code))
      expect(pre.textContent).toBe(code)
      expect(pre.scrollLeft).toBe(24)
    } finally {
      scope.document = doc
      scope.HTMLPreElement = elem
    }
  })
})
