import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Regression guard for the markdown rAF-coalesced parse fix.
 *
 * PROBLEM:
 *   The `Markdown` component's render effect did `temp.innerHTML = content`
 *   + `morphdom(...)` on every update. During LLM token streaming, this
 *   fired 60–200 times per second, reparsing the entire accumulated HTML
 *   every time. CPU profile of a 7s streaming window showed 2,940 ParseHTML
 *   events (~619ms, ~46% of blocked main-thread time).
 *
 * FIX:
 *   Queue the latest content in a component-scoped variable and run the
 *   morphdom pass inside a requestAnimationFrame callback. Further updates
 *   before the frame fires simply overwrite the pending content — K rapid
 *   token updates collapse to 1 parse. The onCleanup handler cancels any
 *   queued frame so it doesn't touch the unmounted DOM.
 *
 * For the matching runtime assertion, see
 * `tests/webview-reactivity/markdown-parse-rate.test.ts`.
 */
describe("Markdown rAF-coalesced parse — regression guard", () => {
  const path = join(__dirname, "..", "..", "..", "ui", "src", "components", "markdown.tsx")

  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  const src = stripComments(readFileSync(path, "utf8"))

  it("render effect uses requestAnimationFrame to coalesce parses", () => {
    // Locate the createEffect that owns the morphdom call.
    const match = src.match(/createEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?morphdom\s*\([\s\S]*?^\s*\}\s*\)/m)
    expect(match, "render createEffect must contain a morphdom call").toBeTruthy()
    const body = match![0]
    expect(body).toMatch(/requestAnimationFrame/)
  })

  it("cleans up the queued frame on dispose", () => {
    expect(src).toMatch(/cancelAnimationFrame/)
  })

  it("exposes a pending frame/content state scoped to the component", () => {
    // Any of these forms count. We just need the state to exist so that
    // rapid updates can collapse into it.
    expect(src).toMatch(/\b(pendingFrame|pendingContent)\b/)
  })
})
