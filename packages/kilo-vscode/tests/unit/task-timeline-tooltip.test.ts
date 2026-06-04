import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Regression guard for timeline tooltip mount cost.
 *
 * A long session can render hundreds of timeline bars. Wrapping every bar in
 * the shared Tooltip component creates a Kobalte tooltip instance and
 * MutationObserver per bar during session activation. The timeline keeps all
 * bars but delegates hover handling to one portal tooltip instead.
 */
describe("TaskTimeline delegated tooltip contract", () => {
  const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "TaskTimeline.tsx")
  const src = readFileSync(path, "utf8")

  it("does not mount one shared Tooltip component per timeline bar", () => {
    expect(src).not.toMatch(/@kilocode\/kilo-ui\/tooltip/)
    expect(src).not.toMatch(/<Tooltip\b/)
  })

  it("keeps bar labels and renders one delegated portal tooltip", () => {
    expect(src).toMatch(/data-tip=\{bar\(\)\.tip\}/)
    expect(src).toMatch(/role="img"/)
    expect(src).toMatch(/aria-label=\{bar\(\)\.tip\}/)
    expect(src).toMatch(/if \(!bar \|\| !ref\?\.contains\(bar\)\) return hideTip\(\)/)
    expect(src).toMatch(/<Portal>/)
    expect(src).toMatch(/class="task-timeline-tooltip"/)
  })
})
