import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveMenuIndex, withDividers, type TimelineBar } from "../../webview-ui/src/utils/timeline/dividers"

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
    expect(src).toMatch(/hit\(layout\(\)\.items, clientX - rect\.left \+ ref\.scrollLeft\)/)
    expect(src).toMatch(/const bar = bars\(\)\[idx\]/)
    expect(src).toMatch(/const detail = stepTip\(stepForPart\(steps\(\), bar\.partId\), t\)/)
    expect(src).toMatch(/text: detail \? `\$\{bar\.tip\} · \$\{detail\}` : bar\.tip/)
    expect(src).toMatch(/<Portal>/)
    expect(src).toMatch(/class="task-timeline-tooltip"/)
  })

  it("keeps accessibility and bar overlays bounded", () => {
    expect(src).toMatch(/data-timeline-count=\{items\(\)\.length\}/)
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
    expect(src).toMatch(/if \(part\.type === "step-start" \|\| part\.type === "step-finish"\) return true/)
    expect(src).toMatch(/isRenderable\(part as SDKPart, m as SDKAssistantMessage\)/)
    expect(src).toMatch(/item\.tool\?\.callID === call && item\.tool\?\.messageID === m\.id/)
  })

  it("inserts dividers at step-end anchors and hides the trailing one while idle", () => {
    const bars: TimelineBar[] = [
      { bg: "#1", tip: "a", width: 12, height: 8, idx: 0, msgId: "m", partId: "a" },
      { bg: "#2", tip: "b", width: 12, height: 20, idx: 1, msgId: "m", partId: "b" },
      { bg: "#3", tip: "c", width: 12, height: 10, idx: 2, msgId: "m", partId: "c" },
    ]

    const idle = withDividers(bars, ["b", "c"], false)
    expect(idle.map((bar) => bar.partId)).toEqual(["a", "b", "", "c"])
    expect(idle[2]).toMatchObject({ divider: true, width: 12, height: 20 })

    const busy = withDividers(bars, ["b", "c"], true)
    expect(busy.map((bar) => bar.partId)).toEqual(["a", "b", "", "c", ""])
  })

  it("resolves menu target from hit test with selected and last-item fallback", () => {
    expect(resolveMenuIndex(2, 0, 4)).toBe(2)
    expect(resolveMenuIndex(-1, 1, 4)).toBe(1)
    expect(resolveMenuIndex(-1, 10, 4)).toBe(3)
    expect(resolveMenuIndex(-1, -1, 0)).toBe(-1)
  })

  it("keeps selected bars highlighted after click and keyboard activation", () => {
    expect(src).toMatch(/const jump = \(idx: number\) => \{[\s\S]*showTip\(idx\)/)
    expect(src).toMatch(/const select = \(idx: number\) => \{\s*jump\(idx\)/)
    expect(src).toMatch(/select\(selected\(\)\)/)
  })

  it("preserves a hovered part across streaming updates", () => {
    expect(src).toMatch(/if \(idx < 0 \|\| same\(previous\?\.\[idx\], next\[idx\]\)\) return/)
    expect(src).toMatch(/if \(same\(previous, next\)\) return previous/)
  })
})
