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

    expect(proc.exitCode, proc.stderr.toString()).toBe(0)
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

    // `inlineCode` is a bare identifier (no extension), so it is not treated
    // as a file-link candidate and renders as plain code with isolated dir.
    expect(html).toContain('<code dir="auto">inlineCode</code>')
    expect(html).toContain('<pre dir="auto"><code class="language-ts" data-lang="ts">')
    expect(html).toContain("const value = 1")
    expect(html.match(/<span dir="auto"><span class="katex/g)?.length).toBe(1)
  })

  test("marks path-like code spans as candidates and leaves bare identifiers plain", async () => {
    const parser = createMarkedParser({})
    const withPath = await Promise.resolve(parser.parse("see `src/foo.ts:12:5`"))
    expect(withPath).toContain('class="file-link-candidate"')
    expect(withPath).toContain('data-file-candidate="./src/foo.ts"')
    expect(withPath).toContain('data-file-line="12"')
    expect(withPath).toContain('data-file-col="5"')

    // Bare identifiers (no extension / not a known extensionless name) are not
    // candidates, so they never trigger filesystem validation.
    const plain = await Promise.resolve(parser.parse("call `useState` here"))
    expect(plain).toContain('<code dir="auto">useState</code>')
    expect(plain).not.toContain("file-link-candidate")
  })

  test("escapes the candidate attribute so a quote can't break out", async () => {
    const parser = createMarkedParser({})
    // Path-like (has an extension) but contains a quote from raw model output.
    const html = await Promise.resolve(parser.parse('`a".ts`'))
    expect(html).toContain('data-file-candidate="./a&quot;.ts"')
    // The quote must be escaped, not left raw to break the attribute and
    // inject a new one.
    expect(html).not.toContain('data-file-candidate="./a".ts"')
  })

  test("tags file-path markdown links but keeps target/rel", async () => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(parser.parse("[open](src/foo.ts)"))
    expect(html).toContain('class="external-link file-path-link"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test("escapes an ampersand in a link href so it can't break the attribute", async () => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(parser.parse("[q](https://e.com/x?a=1&b=2)"))
    expect(html).toContain('href="https://e.com/x?a=1&amp;b=2"')
    expect(html).not.toContain('href="https://e.com/x?a=1&b=2"')
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
