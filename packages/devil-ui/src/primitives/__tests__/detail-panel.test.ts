/**
 * Tests for DetailPanel primitive — including the layout bug-fix verification.
 *
 * Key assertions:
 * 1. Terminal branch has minWidth={0} on inner box (the bug fix)
 * 2. Terminal branch does NOT have width="100%" on body <text> element
 * 3. wrapMode="word" is present on body <text>
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../detail-panel/index.tsx"),
  "utf-8",
)

describe("DetailPanel module structure", () => {
  it("exports DetailPanel function", () => {
    const mod = require("../detail-panel/index.tsx")
    expect(typeof mod.DetailPanel).toBe("function")
  })

  it("exports DetailPanelProps type", () => {
    expect(SRC).toContain("DetailPanelProps")
  })

  it("terminal branch uses minWidth={0} on inner box (BUG FIX)", () => {
    expect(SRC).toContain("minWidth={0}")
  })

  it("terminal branch does NOT set width='100%' as a JSX prop on body text element (BUG FIX)", () => {
    // The specific bug was width="100%" as a JSX attribute on the <text> element.
    // We check that no <text ... width="100%"...> element pattern exists.
    // Filter out comment lines (// and * and {/* ... */} style)
    const lines = SRC.split("\n")
    const nonCommentLines = lines.filter((l) => {
      const t = l.trim()
      return (
        t.includes('width="100%"') &&
        !t.startsWith("//") &&
        !t.startsWith("*") &&
        !t.startsWith("{/*") &&
        !t.startsWith("/*")
      )
    })
    expect(nonCommentLines.length).toBe(0)
  })

  it("terminal branch uses wrapMode='word' on body text", () => {
    expect(SRC).toContain('wrapMode="word"')
  })

  it("uses lazy fallback form for terminal branch (thunk or cast form)", () => {
    // The plan requires lazy evaluation. SolidJS 1.9.x types Show.fallback as JSX.Element,
    // so the lazy thunk must be cast: (() => <TerminalBranch/>) as unknown as JSX.Element.
    // Either form of the pattern must be present.
    const hasThunkForm = SRC.includes("fallback={() =>") || SRC.includes("fallback={(() =>")
    expect(hasThunkForm).toBe(true)
    expect(SRC).toContain("TerminalBranch")
  })

  it("uses useDensityOptional (no throw outside provider)", () => {
    expect(SRC).toContain("useDensityOptional")
  })

  it("DOM branch uses <details>/<summary> semantic HTML", () => {
    expect(SRC).toContain("<details")
    expect(SRC).toContain("<summary")
  })

  it("DOM branch has data-component attribute", () => {
    expect(SRC).toContain('data-component="detail-panel"')
  })

  it("no @opentui static import at module level", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })
})
