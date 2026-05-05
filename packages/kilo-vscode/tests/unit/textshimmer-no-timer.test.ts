import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Regression guard for the TextShimmer JS-timer fix.
 *
 * PROBLEM:
 *   A createEffect inside TextShimmer ran clearTimeout + setTimeout on
 *   every `active` prop change. During LLM token streaming, active props
 *   (bound to `pending()` / `running()` accessors) thrashed, firing the
 *   effect thousands of times per second. CPU profile of a 7s streaming
 *   window showed ~2,500 timer operations (~16% of blocked time).
 *
 * FIX:
 *   Drop the effect and the `run` signal. Gate the CSS animation directly
 *   on the `data-active` attribute. The opacity transition on the shimmer
 *   char already handles the fade over `--text-shimmer-swap` (220ms).
 *
 * This static test fails if someone re-introduces the timer pattern.
 * For the matching runtime assertion, see
 * `tests/webview-reactivity/textshimmer-perf.test.ts`.
 */
describe("TextShimmer JS-timer regression guard", () => {
  const tsxPath = join(__dirname, "..", "..", "..", "ui", "src", "components", "text-shimmer.tsx")
  const cssPath = join(__dirname, "..", "..", "..", "ui", "src", "components", "text-shimmer.css")
  // Strip single-line (// ...), block (/* ... */), and JSX block ({/* ... */})
  // comments so assertions ignore explanatory prose and only match live code.
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  const tsx = stripComments(readFileSync(tsxPath, "utf8"))
  const css = stripComments(readFileSync(cssPath, "utf8"))

  it("text-shimmer.tsx does not use setTimeout", () => {
    expect(tsx).not.toMatch(/\bsetTimeout\b/)
  })

  it("text-shimmer.tsx does not use clearTimeout", () => {
    expect(tsx).not.toMatch(/\bclearTimeout\b/)
  })

  it("text-shimmer.tsx has no createEffect (animation is CSS-driven)", () => {
    expect(tsx).not.toMatch(/\bcreateEffect\b/)
  })

  it("text-shimmer.tsx does not render a data-run attribute", () => {
    expect(tsx).not.toMatch(/data-run/)
  })

  it("text-shimmer.css gates the sweep animation on data-active, not data-run", () => {
    expect(css).not.toMatch(/\[data-run="true"\]/)
    expect(css).toMatch(
      /\[data-component="text-shimmer"\]\[data-active="true"\]\s*\[data-slot="text-shimmer-char-shimmer"\]\s*\{[^}]*animation-name:\s*text-shimmer-sweep/,
    )
  })

  it("text-shimmer.tsx does not use clearTimeout", () => {
    expect(tsx).not.toMatch(/\bclearTimeout\b/)
  })

  it("text-shimmer.tsx has no createEffect (animation is CSS-driven)", () => {
    expect(tsx).not.toMatch(/\bcreateEffect\b/)
  })

  it("text-shimmer.tsx does not render a data-run attribute", () => {
    expect(tsx).not.toMatch(/data-run/)
  })

  it("text-shimmer.css gates the sweep animation on data-active, not data-run", () => {
    expect(css).not.toMatch(/\[data-run="true"\]/)
    expect(css).toMatch(
      /\[data-component="text-shimmer"\]\[data-active="true"\]\s*\[data-slot="text-shimmer-char-shimmer"\]\s*\{[^}]*animation-name:\s*text-shimmer-sweep/,
    )
  })
})
