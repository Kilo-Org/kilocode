import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import path from "node:path"
import { createMarkedParser } from "../context/marked"
import { fnv1a } from "../context/marked"
import { update } from "./markdown-stream-highlight"

const root = path.resolve(import.meta.dir, "../..")

describe("Markdown bidirectional rendering contract", () => {
  test("renders the markdown root with automatic direction", () => {
    const code = String.raw`
      import { mock } from "bun:test"
      import { createComponent, renderToString } from "solid-js/web"

      function attr(props) {
        return Object.entries(props || {})
          .filter(([key, value]) => key !== "children" && value != null && value !== false && typeof value !== "object")
          .map(([key, value]) => " " + (key === "className" ? "class" : key) + "=\"" + String(value) + "\"")
          .join("")
      }

      globalThis.React = {
        createElement(type, props, ...children) {
          const next = { ...(props || {}) }
          if (children.length) next.children = children.length === 1 ? children[0] : children
          if (typeof type === "function") return createComponent(type, next)
          return "<" + type + attr(next) + ">" + children.join("") + "</" + type + ">"
        },
      }

      mock.module("./src/context/marked", () => ({
        useMarked: () => ({ parse: async () => "" }),
        deferredHighlight: async () => {},
        fnv1a: (text) => text,
      }))
      mock.module("./src/kilocode/markdown-mermaid", () => ({
        hasMermaid: () => false,
        preserveMermaid: () => false,
        renderMermaid: async () => {},
      }))

      const { Markdown } = await import("./src/components/markdown")
      console.log(renderToString(() => createComponent(Markdown, { text: "hello" })))
    `
    const proc = Bun.spawnSync({
      cmd: ["bun", "-e", code],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(proc.exitCode).toBe(0)
    const html = proc.stdout.toString()
    expect(html).toContain('data-component="markdown"')
    expect(html).toContain('dir="auto"')
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
    const win = new Window()
    const scope = globalThis as typeof globalThis & {
      document: Document
      HTMLPreElement: typeof HTMLPreElement
    }
    const doc = scope.document
    const elem = scope.HTMLPreElement

    try {
      scope.document = win.document as unknown as Document
      scope.HTMLPreElement = win.HTMLPreElement as unknown as typeof HTMLPreElement

      const pre = document.createElement("pre")
      const code = "const value = 1"
      pre.setAttribute("dir", "auto")
      pre.setAttribute("data-old", "removed")
      pre.scrollLeft = 24
      pre.innerHTML = `<code data-lang="ts">${code}</code>`
      document.body.append(pre)

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
