import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Regression guard for the GrowBox ResizeObserver layout-read fix.
 *
 * PROBLEM:
 *   `GrowBox` wraps the currently-streaming assistant part (watch={true}).
 *   Its ResizeObserver callback called `body.getBoundingClientRect().height`
 *   via `setHeight()` → `targetHeight()` on every body-size change. During
 *   streaming, this fires ~60Hz and each call forces a synchronous layout.
 *   CPU profile of a 7s streaming window showed 1,362 getBoundingClientRect
 *   samples (~9% of blocked main-thread time) attributable to this path.
 *
 * FIX:
 *   Use the browser-measured `contentBoxSize` / `contentRect` on each
 *   observer entry instead. No extra layout read. Also skip sub-pixel
 *   updates (<2px) the spring absorbs imperceptibly anyway.
 *
 * This static test fails if someone reintroduces the getBoundingClientRect
 * call inside the ResizeObserver callback or removes the delta guard.
 *
 * For the matching runtime assertion, see
 * `tests/webview-reactivity/growbox-perf.test.ts`.
 */
describe("GrowBox ResizeObserver layout-read regression guard", () => {
  const path = join(__dirname, "..", "..", "..", "kilo-ui", "src", "components", "grow-box.tsx")

  // Strip single-line, block, and JSX block comments so assertions match
  // only live code.
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  const src = stripComments(readFileSync(path, "utf8"))

  it("ResizeObserver callback does not call getBoundingClientRect", () => {
    // Extract the ResizeObserver block up to the first observer.observe call.
    const match = src.match(/new\s+ResizeObserver\s*\([\s\S]*?observer\.observe\(/)
    expect(match, "ResizeObserver setup must exist in GrowBox").toBeTruthy()
    const block = match![0]
    expect(block).not.toMatch(/getBoundingClientRect/)
  })

  it("ResizeObserver callback uses the observer entry's contentRect or contentBoxSize", () => {
    const match = src.match(/new\s+ResizeObserver\s*\(\s*\(?\s*entries[\s\S]*?observer\.observe\(/)
    expect(match, "ResizeObserver callback must accept and read an entries parameter").toBeTruthy()
    const block = match![0]
    expect(block).toMatch(/contentBoxSize|contentRect/)
  })

  it("has a sub-pixel delta guard in the measured-height setter", () => {
    expect(src).toMatch(/Math\.abs\(\s*next\s*-\s*springTarget\s*\)\s*<\s*2/)
  })
})
