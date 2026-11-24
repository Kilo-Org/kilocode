/**
 * Architecture test: prompt input font size on touch devices (#15607).
 *
 * packages/ui/src/styles/base.css forces `font-size: 16px !important` on
 * textareas under `(hover: none) and (pointer: coarse)` to stop iOS zoom. The
 * prompt textarea is transparent and the highlight overlay draws its text, so
 * under that media query the textarea must keep the overlay's font size, or the
 * caret and selection drift away from the visible text.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const PROMPT = fs.readFileSync(path.join(ROOT, "webview-ui/src/styles/prompt-input.css"), "utf-8")
const MEDIA = "@media (hover: none) and (pointer: coarse)"

function block(css: string) {
  const start = css.indexOf(MEDIA)
  if (start < 0) return ""
  const open = css.indexOf("{", start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i)
  }
  return ""
}

function size(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{[^}]*?font-size:\\s*([^;]+);`).exec(css)?.[1]?.trim()
}

describe("prompt input coarse-pointer font size", () => {
  it("keeps the textarea at the highlight overlay's font size", () => {
    const overlay = size(PROMPT, ".prompt-input-highlight-overlay")
    expect(overlay).toBeDefined()
    expect(size(block(PROMPT), ".prompt-input")).toBe(`${overlay} !important`)
  })
})
