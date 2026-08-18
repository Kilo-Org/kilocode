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

  it("delegates SVG hit testing to one portal tooltip", () => {
    expect(src).toMatch(/hit\(layout\(\)\.items, e\.clientX - rect\.left \+ ref\.scrollLeft\)/)
    expect(src).toMatch(/const bar = bars\(\)\[idx\]/)
    expect(src).toMatch(/text: bar\.tip/)
    expect(src).toMatch(/<Portal>/)
    expect(src).toMatch(/class="task-timeline-tooltip"/)
  })

  it("keeps accessibility and bar overlays bounded", () => {
    expect(src).toMatch(/data-timeline-count=\{bars\(\)\.length\}/)
    expect(src).toMatch(/tabIndex=\{0\}/)
    expect(src).toMatch(/role="slider"/)
    expect(src).toMatch(/aria-valuenow=\{value\(\)\}/)
    expect(src).toMatch(/aria-valuetext=\{aria\(\)\}/)
    expect(src).toMatch(/<For each=\{layout\(\)\.paths\}>/)
    expect(src).not.toMatch(/<Index\b/)
    expect(src).not.toMatch(/data-tip=/)
  })

  it("only collects parts with matching transcript content", () => {
    expect(src).toMatch(/const revert = session\.revert\(\) \?\? undefined/)
    expect(src).toMatch(/visibleParts\(m\.id, session\.getParts\(m\.id\), revert\)/)
    expect(src).toMatch(/isRenderable\(part as SDKPart, m as SDKAssistantMessage\)/)
    expect(src).toMatch(/item\.tool\?\.callID === call && item\.tool\?\.messageID === m\.id/)
  })

  it("keeps selected bars highlighted after click and keyboard activation", () => {
    expect(src).toMatch(/const select = \(idx: number\) => \{[\s\S]*showTip\(idx\)/)
    expect(src).toMatch(/select\(selected\(\)\)/)
  })

  it("preserves a hovered part across streaming updates", () => {
    expect(src).toMatch(/if \(idx < 0 \|\| same\(previous\?\.\[idx\], next\[idx\]\)\) return/)
    expect(src).toMatch(/if \(same\(previous, next\)\) return previous/)
  })
})
