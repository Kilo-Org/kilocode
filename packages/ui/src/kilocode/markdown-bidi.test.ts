import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import path from "node:path"
import { createMarkedParser } from "../context/marked"
import { fnv1a } from "../context/marked"
import { applyTextDirection } from "./text-direction"
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
        KiloTheme: { name: "Kilo" },
      }))
      mock.module("./src/kilocode/markdown-mermaid", () => ({
        hasMermaid: () => false,
        preserveMermaid: () => false,
        renderMermaid: async () => {},
      }))
      mock.module("./src/components/markdown-worker", () => ({
        disposeStreamingCode: () => {},
        highlightStreamingCode: async () => { throw new Error("unexpected worker call") },
        MarkdownWorkerDisposedError: class extends Error {},
        MarkdownWorkerSupersededError: class extends Error {},
        MarkdownWorkerUnavailableError: class extends Error {},
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

  test("gives each rendered element its own direction so mixed documents stay readable", async () => {
    // A finished message is a single block covering the whole document, so a
    // block-level direction would force these three paragraphs to share one
    // and flip the English ones. Direction has to land per rendered element.
    const parser = createMarkedParser({})
    const html = await Promise.resolve(
      parser.parse(
        [
          "This paragraph is written in English and must stay left to right.",
          "",
          "OK باشه من این تابع را عوض میکنم و بعد تست را اجرا میکنم.",
          "",
          "Another English paragraph follows the Persian one.",
        ].join("\n"),
      ),
    )

    const win = new Window()
    const block = win.document.createElement("div")
    block.innerHTML = html
    applyTextDirection(block as unknown as Element)

    const rendered = Array.from(block.children).map((el) => [el.getAttribute("dir"), el.textContent.trim()])
    expect(rendered.length).toBe(3)
    expect(rendered.map(([dir]) => dir)).toEqual(["ltr", "rtl", "ltr"])
    expect(rendered[1][1]).toContain("باشه")
  })

  test("resolves a pending block as a whole while its prose is still bare text", () => {
    const win = new Window()
    const block = win.document.createElement("div")
    // What `fallback()` emits before a parse resolves: escaped source with <br>
    // separators, so the prose has no element to carry a direction.
    block.innerHTML = "OK باشه من این تابع را عوض میکنم<br><br>و بعد تست را اجرا میکنم"
    applyTextDirection(block as unknown as Element)

    expect(block.getAttribute("dir")).toBe("rtl")
  })

  test("keeps rendered code from voting for the prose direction around it", async () => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(parser.parse("لطفا `handleSubmit` و `validateForm` را صدا بزن"))

    const win = new Window()
    const block = win.document.createElement("div")
    block.innerHTML = html
    applyTextDirection(block as unknown as Element)

    // Two latin identifiers outnumber nothing here: the inline code is skipped
    // entirely, so only the Persian prose votes.
    expect(block.children[0].getAttribute("dir")).toBe("rtl")
  })

  test("renders code, pre, and math with isolated direction", async () => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(
      parser.parse(
        ["متن با `format()`", "", "```ts", "const value = 1", "```", "", "$$", "a = b + c", "$$"].join("\n"),
      ),
    )

    // `format()` contains code punctuation, so it is not a file-link candidate
    // and renders as plain code with isolated dir.
    expect(html).toContain('<code dir="auto">format()</code>')
    expect(html).toContain('<pre dir="auto"><code class="language-ts" data-lang="ts">')
    expect(html).toContain("const value = 1")
    expect(html.match(/<span dir="auto"><span class="katex/g)?.length).toBe(1)
  })

  test("marks path-like and extensionless code spans as candidates, leaving code expressions plain", async () => {
    const parser = createMarkedParser({})
    const withPath = await Promise.resolve(parser.parse("see `src/foo.ts:12:5`"))
    expect(withPath).toContain('class="file-link-candidate"')
    expect(withPath).toContain('data-file-candidate="./src/foo.ts"')
    expect(withPath).toContain('data-file-line="12"')
    expect(withPath).toContain('data-file-col="5"')

    // Extensionless files (e.g. `install`) are candidates too — the filesystem
    // check downstream decides whether they resolve to a real file.
    const bare = await Promise.resolve(parser.parse("run `install` here"))
    expect(bare).toContain('class="file-link-candidate"')
    expect(bare).toContain('data-file-candidate="./install"')

    // Spans with code punctuation are not candidates, so they never probe.
    const plain = await Promise.resolve(parser.parse("call `useState()` here"))
    expect(plain).toContain('<code dir="auto">useState()</code>')
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
