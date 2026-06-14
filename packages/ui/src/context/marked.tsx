import { marked } from "marked"
// kilocode_change: marked-shiki highlighted code blocks synchronously during
// parse, freezing the main thread on session switches with many code blocks
// (issue #6221 / PR #7102). We render plain <pre><code data-lang="..."> here
// and hand off to deferredHighlight() in markdown.tsx for progressive Shiki.
// This import was re-added by an upstream merge; removing it restores the
// two-pass rendering design.
import katex from "katex"
// kilocode_change start: import types for double-dollar math extension
import type { MarkedExtension, TokenizerAndRendererExtension } from "marked"
// kilocode_change end
import { bundledLanguages, type BundledLanguage } from "shiki"
import { extractSuffix, normalizeCandidatePath, extractFilePathFromHref } from "../file-path" // kilocode_change
import { createSimpleContext } from "./helper"
import { getSharedHighlighter } from "@pierre/diffs" // kilocode_change
import { ensureKiloDiffTheme } from "../pierre/kilo-diff-theme" // kilocode_change

// kilocode_change start: the "Kilo" diff/highlight theme registration moved to
// ../pierre/kilo-diff-theme so the diff worker pool can register it without
// importing this module's katex/marked dependencies. This call keeps the markdown
// highlighter (getSharedHighlighter, below) working. Upstream keeps an inline
// registerCustomTheme("OpenCode", …) block here — do not restore it on merges;
// route registration through ensureKiloDiffTheme() instead.
ensureKiloDiffTheme()
// kilocode_change end

// kilocode_change start: double-dollar-only math rules for marked.
const BLOCK = /^\$\$\n((?:\\[^]|[^\\])+?)\n\$\$(?:\n|$)/
const INLINE = /^\$\$(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\$\$/
// kilocode_change end

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

  // kilocode_change: removed single-dollar inline math ($...$) rendering.
  // Single $ is far more common as a currency symbol in agent responses
  // (e.g. $93K, $307K) than as a LaTeX delimiter. Only $$...$$ is supported.

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

  const highlighter = await getSharedHighlighter({
    themes: ["Kilo"],
    langs: [],
    preferredHighlighter: "shiki-wasm",
  })

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
    container.querySelectorAll('pre > code[data-lang]:not([data-highlighted]):not([data-lang="mermaid"])'),
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
        // Re-check inside the timer callback — signal may have been aborted while
        // this task was queued in the event loop waiting to run.
        if (!block.isConnected || signal?.aborted) {
          resolve()
          return
        }
        try {
          const language = lang in bundledLanguages ? lang : "text"
          const highlight = () => {
            // Re-check after async loadLanguage — block may have been replaced
            // or signal aborted while the language bundle was being fetched.
            if (!block.isConnected || signal?.aborted) {
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
            highlighter
              .loadLanguage(language as BundledLanguage)
              .then(highlight)
              .catch((err) => {
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
            // kilocode_change: file-path links get a distinct class for styling
            const isFile = href ? extractFilePathFromHref(href) : undefined
            if (isFile) {
              return `<a href="${href}"${titleAttr} class="external-link file-path-link">${text}</a>`
            }
            return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
          },
          // kilocode_change start — every code span is a file-link candidate.
          // Post-render validation (via filesystem stat) will strip the class
          // from candidates that don't correspond to real files.
          codespan({ text }) {
            const escaped = text
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;")
            // Skip obvious non-paths: contains spaces, URLs, or is empty
            if (!text || text.includes(" ") || text.includes("://")) {
              return `<code>${escaped}</code>`
            }
            const { candidate, line, column } = extractSuffix(text)
            const normalized = normalizeCandidatePath(candidate)
            const lineAttr = line ? ` data-file-line="${line}"` : ""
            const colAttr = column ? ` data-file-col="${column}"` : ""
            return `<code class="file-link-candidate" data-file-candidate="${normalized}"${lineAttr}${colAttr}>${escaped}</code>`
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
            const data = safe.toLowerCase() === "mermaid" ? "mermaid" : safe
            const attr = data ? ` class="language-${data}" data-lang="${data}"` : ' data-lang="text"'
            return `<pre><code${attr}>${escaped}</code></pre>`
          },
          // kilocode_change end
        },
      },
      // kilocode_change start: enable only double-dollar math.
      // Single $ is far more common as a currency symbol in agent responses
      // (e.g. $93K, $307K) than as a LaTeX delimiter. Avoid registering the
      // marked-katex-extension inline tokenizer because Marked falls through
      // to later tokenizers when an override returns undefined.
      {
        extensions: [
          {
            name: "doubleKatexBlock",
            level: "block" as const,
            tokenizer(src) {
              const match = src.match(BLOCK)
              const text = match?.[1]
              if (!match || !text) return undefined
              return {
                type: "doubleKatexBlock",
                raw: match[0],
                text: text.trim(),
              }
            },
            renderer(token) {
              return `${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}\n`
            },
          } satisfies TokenizerAndRendererExtension,
          {
            name: "doubleKatexInline",
            level: "inline" as const,
            start(src) {
              const index = src.indexOf("$$")
              if (index === -1) return undefined
              return index
            },
            tokenizer(src) {
              const match = src.match(INLINE)
              const text = match?.[1]
              if (!match || !text) return undefined
              return {
                type: "doubleKatexInline",
                raw: match[0],
                text: text.trim(),
              }
            },
            renderer(token) {
              return katex.renderToString(token.text, { displayMode: true, throwOnError: false })
            },
          } satisfies TokenizerAndRendererExtension,
        ],
      } satisfies MarkedExtension,
      // kilocode_change end
      // kilocode_change: markedShiki removed — the custom `code` renderer
      // above returns plain <pre><code data-lang="..."> and markdown.tsx
      // calls deferredHighlight() after paint. Running Shiki inside parse
      // blocks the main thread on session switches (issue #6221).
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
