import { marked } from "marked"
import markedKatex from "marked-katex-extension"

import katex from "katex"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter, registerCustomTheme, ThemeRegistrationResolved } from "@pierre/diffs"

registerCustomTheme("Kilo", () => {
  return Promise.resolve({
    name: "Kilo",
    colors: {
      "editor.background": "var(--color-background-stronger)",
      "editor.foreground": "var(--text-base)",
      "gitDecoration.addedResourceForeground": "var(--syntax-diff-add)",
      "gitDecoration.deletedResourceForeground": "var(--syntax-diff-delete)",
      // "gitDecoration.conflictingResourceForeground": "#ffca00",
      // "gitDecoration.modifiedResourceForeground": "#1a76d4",
      // "gitDecoration.untrackedResourceForeground": "#00cab1",
      // "gitDecoration.ignoredResourceForeground": "#84848A",
      // "terminal.titleForeground": "#adadb1",
      // "terminal.titleInactiveForeground": "#84848A",
      // "terminal.background": "#141415",
      // "terminal.foreground": "#adadb1",
      // "terminal.ansiBlack": "#141415",
      // "terminal.ansiRed": "#ff2e3f",
      // "terminal.ansiGreen": "#0dbe4e",
      // "terminal.ansiYellow": "#ffca00",
      // "terminal.ansiBlue": "#008cff",
      // "terminal.ansiMagenta": "#c635e4",
      // "terminal.ansiCyan": "#08c0ef",
      // "terminal.ansiWhite": "#c6c6c8",
      // "terminal.ansiBrightBlack": "#141415",
      // "terminal.ansiBrightRed": "#ff2e3f",
      // "terminal.ansiBrightGreen": "#0dbe4e",
      // "terminal.ansiBrightYellow": "#ffca00",
      // "terminal.ansiBrightBlue": "#008cff",
      // "terminal.ansiBrightMagenta": "#c635e4",
      // "terminal.ansiBrightCyan": "#08c0ef",
      // "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: {
          foreground: "var(--syntax-comment)",
        },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: {
          foreground: "var(--syntax-property)", // maybe attribute
        },
      },
      {
        scope: ["constant", "entity.name.constant", "variable.other.constant", "variable.language", "entity"],
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: ["meta.object.member"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "variable.parameter.function",
          "meta.jsx.children",
          "meta.block",
          "meta.tag.attributes",
          "entity.name.constant",
          "meta.embedded.expression",
          "meta.template.expression",
          "string.other.begin.yaml",
          "string.other.end.yaml",
        ],
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["entity.name.function", "support.type.primitive"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.class.component"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: [
          "keyword.operator",
          "storage.type.function.arrow",
          "punctuation.separator.key-value.css",
          "entity.name.tag.yaml",
          "punctuation.separator.key-value.mapping.yaml",
        ],
        settings: {
          foreground: "var(--syntax-operator)",
        },
      },
      {
        scope: ["storage", "storage.type"],
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: ["storage.modifier.package", "storage.modifier.import", "storage.type.java"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "string",
          "punctuation.definition.string",
          "string punctuation.section.embedded source",
          "entity.name.tag",
        ],
        settings: {
          foreground: "var(--syntax-string)",
        },
      },
      {
        scope: "support",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.type.object.module", "variable.other.object", "support.type.property-name.css"],
        settings: {
          foreground: "var(--syntax-object)",
        },
      },
      {
        scope: "meta.property-name",
        settings: {
          foreground: "var(--syntax-property)",
        },
      },
      {
        scope: "variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "variable.other",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: [
          "invalid.broken",
          "invalid.illegal",
          "invalid.unimplemented",
          "invalid.deprecated",
          "message.error",
          "markup.deleted",
          "meta.diff.header.from-file",
          "punctuation.definition.deleted",
          "brackethighlighter.unmatched",
          "token.error-token",
        ],
        settings: {
          foreground: "var(--syntax-critical)",
        },
      },
      {
        scope: "carriage-return",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: "string source",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "string variable",
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: [
          "source.regexp",
          "string.regexp",
          "string.regexp.character-class",
          "string.regexp constant.character.escape",
          "string.regexp source.ruby.embedded",
          "string.regexp string.regexp.arbitrary-repitition",
          "string.regexp constant.character.escape",
        ],
        settings: {
          foreground: "var(--syntax-regexp)",
        },
      },
      {
        scope: "support.constant",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: "support.variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "meta.module-reference",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.quote",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.italic",
        settings: {
          fontStyle: "italic",
          // foreground: "",
        },
      },
      {
        scope: "markup.bold",
        settings: {
          fontStyle: "bold",
          foreground: "var(--text-strong)",
        },
      },
      {
        scope: [
          "markup.raw",
          "markup.inserted",
          "meta.diff.header.to-file",
          "punctuation.definition.inserted",
          "markup.changed",
          "punctuation.definition.changed",
          "markup.ignored",
          "markup.untracked",
        ],
        settings: {
          foreground: "var(--text-base)",
        },
      },
      {
        scope: "meta.diff.range",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.diff.header",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.separator",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.output",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.export.default",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: [
          "brackethighlighter.tag",
          "brackethighlighter.curly",
          "brackethighlighter.round",
          "brackethighlighter.square",
          "brackethighlighter.angle",
          "brackethighlighter.quote",
        ],
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: ["constant.other.reference.link", "string.other.link"],
        settings: {
          fontStyle: "underline",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "var(--syntax-warning)",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
    ],
    semanticTokenColors: {
      comment: "var(--syntax-comment)",
      string: "var(--syntax-string)",
      number: "var(--syntax-constant)",
      regexp: "var(--syntax-regexp)",
      keyword: "var(--syntax-keyword)",
      variable: "var(--syntax-variable)",
      parameter: "var(--syntax-variable)",
      property: "var(--syntax-property)",
      function: "var(--syntax-primitive)",
      method: "var(--syntax-primitive)",
      type: "var(--syntax-type)",
      class: "var(--syntax-type)",
      namespace: "var(--syntax-type)",
      enumMember: "var(--syntax-primitive)",
      "variable.constant": "var(--syntax-constant)",
      "variable.defaultLibrary": "var(--syntax-unknown)",
    },
  } as unknown as ThemeRegistrationResolved)
})

function renderMathInText(text: string): string {
  let result = text

  // Display math: $$...$$
  const displayMathRegex = /\$\$([\s\S]*?)\$\$/g
  result = result.replace(displayMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
      })
    } catch {
      return `$$${math}$$`
    }
  })

  // Inline math: $...$
  const inlineMathRegex = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g
  result = result.replace(inlineMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
      })
    } catch {
      return `$${math}$`
    }
  })

  return result
}

function renderMathExpressions(html: string): string {
  // Split on code/pre/kbd tags to avoid processing their contents
  const codeBlockPattern = /(<(?:pre|code|kbd)[^>]*>[\s\S]*?<\/(?:pre|code|kbd)>)/gi
  const parts = html.split(codeBlockPattern)

  return parts
    .map((part, i) => {
      // Odd indices are the captured code blocks - leave them alone
      if (i % 2 === 1) return part
      // Process math only in non-code parts
      return renderMathInText(part)
    })
    .join("")
}

// Used only by the native parser path (props.nativeParser) — not the JS parser.
// The JS parser uses deferredHighlight() instead for non-blocking rendering.
async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  const highlighter = await getSharedHighlighter({ themes: ["Kilo"], langs: [] })

  let result = html
  for (const match of matches) {
    const [fullMatch, lang, escapedCode] = match
    const code = escapedCode
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

    let language = lang || "text"
    if (!(language in bundledLanguages)) {
      language = "text"
    }
    if (!highlighter.getLoadedLanguages().includes(language)) {
      await highlighter.loadLanguage(language as BundledLanguage)
    }

    const highlighted = highlighter.codeToHtml(code, {
      lang: language,
      theme: "Kilo",
      tabindex: false,
    })
    result = result.replace(fullMatch, () => highlighted)
  }

  return result
}

export type NativeMarkdownParser = (markdown: string) => Promise<string>

// kilocode_change start
// Matches text that looks like a file path: contains "/" and ends with a file extension,
// or starts with "./" or "../" or "/". Supports optional :line or :line:col suffix.
const FILE_PATH_RE =
  /^((?:\/|\.\.?\/)?(?:[a-zA-Z0-9_@-][a-zA-Z0-9_@./-]*\/)*[a-zA-Z0-9_@.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?$/

function parseFilePath(text: string): { path: string; line?: number; column?: number } | undefined {
  if (text.includes("://")) return undefined
  if (text.includes(" ")) return undefined
  const match = FILE_PATH_RE.exec(text)
  if (!match) return undefined
  if (!match[1].includes("/")) return undefined
  return {
    path: match[1],
    line: match[2] ? parseInt(match[2], 10) : undefined,
    column: match[3] ? parseInt(match[3], 10) : undefined,
  }
}
// kilocode_change end

// kilocode_change start: highlight cache for deferred highlighting

/** FNV-1a hash — lightweight alternative to storing full source code in DOM attributes. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 500

// Normalize common language aliases before sanitizing, so e.g. "c++" → "cpp"
// rather than stripping to "c" (which would highlight as the wrong language).
const LANG_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  "f#": "fsharp",
  "objective-c++": "objective-cpp",
}

function touchHighlightCache(key: string, value: string) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size <= CACHE_LIMIT) return
  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

function replaceWithHighlighted(block: Element, html: string, sourceHash: string) {
  const pre = block.parentElement
  if (!pre || !pre.isConnected) return
  const temp = document.createElement("div")
  temp.innerHTML = html
  const highlighted = temp.firstElementChild
  if (!highlighted) return
  // Store a hash of the source code so the morphdom guard in Markdown can detect
  // mid-stream content changes without keeping the full source in the DOM.
  highlighted.setAttribute("data-source-hash", sourceHash)
  // Preserve any wrapper structure (e.g., markdown-code wrapper with copy button)
  const wrapper = pre.parentElement
  if (wrapper?.getAttribute("data-component") === "markdown-code") {
    wrapper.replaceChild(highlighted, pre)
    return
  }
  pre.replaceWith(highlighted)
}

/**
 * Progressively highlight unhighlighted <pre><code> blocks inside a container.
 * Each block is highlighted via setTimeout(0) to yield back to the main thread
 * between blocks, keeping the UI responsive.
 *
 * Blocks marked with data-highlighted are skipped (already processed).
 * After highlighting, blocks are marked to survive morphdom re-runs during streaming.
 *
 * Returns a callback to re-run setupCodeCopy after highlighting completes,
 * since highlight replaces DOM nodes that may have copy button wrappers.
 */
export async function deferredHighlight(
  container: HTMLElement,
  onComplete?: () => void,
  signal?: { aborted: boolean },
): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll("pre > code[data-lang]:not([data-highlighted])"),
  )
  if (blocks.length === 0) {
    onComplete?.()
    return
  }

  const highlighter = await getSharedHighlighter({ themes: ["Kilo"], langs: [] })

  for (const block of blocks) {
    // Short-circuit if the container is unmounted or the caller cancelled this run
    // (e.g., a newer streaming token triggered a fresh deferredHighlight call).
    if (!container.isConnected || signal?.aborted) break

    const lang = block.getAttribute("data-lang") || "text"
    const code = block.textContent ?? ""
    if (!code) continue

    const cacheKey = `${lang}\0${code}`
    const codeHash = fnv1a(code)
    const cached = cache.get(cacheKey)
    if (cached) {
      touchHighlightCache(cacheKey, cached) // refresh LRU position on hit
      replaceWithHighlighted(block, cached, codeHash)
      continue
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!block.isConnected) {
          resolve()
          return
        }
        try {
          const language = lang in bundledLanguages ? lang : "text"
          const highlight = () => {
            // kilocode_change: re-check after async loadLanguage — block may have
            // been removed from DOM while the language bundle was being fetched.
            if (!block.isConnected) {
              resolve()
              return
            }
            const html = highlighter.codeToHtml(code, { lang: language, theme: "Kilo", tabindex: false })
            touchHighlightCache(cacheKey, html)
            // Note: data-highlighted is NOT set on `block` here because
            // replaceWithHighlighted replaces the parent <pre> entirely — the
            // original <code> element leaves the DOM immediately after this call.
            // The new highlighted <pre class="shiki"> from Shiki has no
            // code[data-lang] child, so the querySelectorAll selector won't
            // pick it up on subsequent deferredHighlight passes.
            replaceWithHighlighted(block, html, codeHash)
            resolve()
          }
          if (!highlighter.getLoadedLanguages().includes(language)) {
            highlighter.loadLanguage(language as BundledLanguage).then(highlight).catch((err) => {
              console.warn("Failed to load language for highlighting", language, err)
              resolve()
            })
            return
          }
          highlight()
        } catch (err) {
          console.warn("Deferred highlight failed", lang, err)
          resolve()
        }
      }, 0)
    })
  }

  // Only fire onComplete if the container is still mounted and the run wasn't
  // cancelled — avoids calling setupCodeCopy on a disconnected DOM tree.
  if (container.isConnected && !signal?.aborted) {
    onComplete?.()
  }
}
// kilocode_change end

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: (props: { nativeParser?: NativeMarkdownParser }) => {
    // kilocode_change start: two-pass parser — first pass skips Shiki highlighting
    // to avoid blocking the main thread with Oniguruma WASM regex (issue #6221).
    // Code blocks render as plain <pre><code data-lang="..."> immediately.
    // The Markdown component calls deferredHighlight() after DOM paint.
    const parser = marked.use(
      {
        renderer: {
          link({ href, title, text }) {
            const titleAttr = title ? ` title="${title}"` : ""
            return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
          },
          // kilocode_change start
          codespan({ text }) {
            const file = parseFilePath(text)
            if (file) {
              const lineAttr = file.line ? ` data-file-line="${file.line}"` : ""
              const colAttr = file.column ? ` data-file-col="${file.column}"` : ""
              return `<code class="file-link" data-file-path="${file.path}"${lineAttr}${colAttr}>${text}</code>`
            }
            return `<code>${text}</code>`
          },
          code({ text, lang }) {
            const escaped = text
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;")
            // Normalize aliases (e.g. "c++" → "cpp") before stripping special
            // chars, so "c++" doesn't become "c" (wrong language highlight).
            const normalized = lang ? (LANG_ALIASES[lang] ?? lang) : ""
            const safe = normalized ? normalized.replace(/[^a-zA-Z0-9_-]/g, "") : ""
            const attr = safe ? ` class="language-${safe}" data-lang="${safe}"` : ' data-lang="text"'
            return `<pre><code${attr}>${escaped}</code></pre>`
          },
          // kilocode_change end
        },
      },
      markedKatex({
        throwOnError: false,
        nonStandard: true,
      }),
    )
    // kilocode_change end

    if (props.nativeParser) {
      const nativeParser = props.nativeParser
      return {
        async parse(markdown: string): Promise<string> {
          const html = await nativeParser(markdown)
          const withMath = renderMathExpressions(html)
          return highlightCodeBlocks(withMath)
        },
      }
    }

    return parser
  },
})
