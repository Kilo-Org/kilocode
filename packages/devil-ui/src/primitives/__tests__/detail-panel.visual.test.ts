import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// detail-panel.visual.test.ts — bleed regression + structural invariant (R3-15).
//
// Playwright snapshot (STORYBOOK_CI=1 gated) tests would go here, but Storybook-CI
// is not wired in Phase 5. The always-required structural assertion verifies that
// the DetailPanel primitive:
//   - uses minWidth={0} on the body container (not width="100%" on the text node)
//   - does NOT set width="100%" which caused the Phase 3 bleed artifact
//     (`PasteNphasetrequirements` concatenation in terminal layout)
//
// This is the code-inspection approach — no runtime or browser required.

const DETAIL_PANEL_SRC = join(
  import.meta.dir,
  "../detail-panel/index.tsx",
)

describe("DetailPanel — character bleed regression (structural)", () => {
  it("source file exists", () => {
    // Throws if file not found
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    expect(src.length).toBeGreaterThan(0)
  })

  it("body container uses minWidth={0} — text node has no width prop (Phase 3 bleed fix)", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    // Must have minWidth={0} on the wrapping box
    expect(src).toContain("minWidth={0}")
    // Must NOT set width="100%" as a JSX/h() prop on text elements
    // The bug was: <text wrapMode="word" width="100%"> or h("text", { width: "100%" })
    // Check the actual h() call doesn't pass width: "100%"
    expect(src).not.toContain('width: "100%"')
    expect(src).not.toMatch(/wrapMode.*width="100%"/)
  })

  it("terminal branch builds layout via h() — text node has no width, box has minWidth:0", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    // The h() call for the inner box must have minWidth: 0 (object prop)
    expect(src).toContain("minWidth: 0")
    // minWidth:0 also appears in DOM branch style objects
    expect(src).toContain('"min-width": "0"')
  })

  it("component exports DetailPanel function", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    expect(src).toContain("export function DetailPanel(")
  })

  it("component uses useDensityOptional (never throws outside provider)", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    expect(src).toContain("useDensityOptional()")
    // Must NOT use useDensity() which throws outside DensityProvider
    expect(src).not.toMatch(/\buseDensity\(\)/)
  })

  it("component renders both DOM and terminal branches via Show + useRenderTarget", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    expect(src).toContain("useRenderTarget()")
    expect(src).toContain("DomBranch")
    expect(src).toContain("TerminalBranch")
  })

  it("DetailPanelProps declares title: string and body: string", () => {
    const src = readFileSync(DETAIL_PANEL_SRC, "utf8")
    expect(src).toContain("title: string")
    expect(src).toContain("body: string")
  })
})

// Conditional Playwright snapshot — only runs when Storybook CI is active (R3-15).
// In Phase 5, STORYBOOK_CI is not set; this block is a stub for future CI integration.
if (process.env.STORYBOOK_CI === "1") {
  describe("DetailPanel — Playwright snapshot (STORYBOOK_CI only)", () => {
    it.skip("snapshot: detail-panel LongBody story has no character bleed", () => {
      // TODO Phase 9: wire Playwright + Storybook CI.
      // await page.goto("http://localhost:6006/iframe.html?id=primitives-detail-panel--long-body&viewMode=story")
      // const panel = await page.locator("[data-component='detail-panel']").first()
      // const body = await panel.textContent()
      // expect(body).not.toContain("PasteNphasetrequirements")
      // await expect(panel).toHaveScreenshot("detail-panel-longbody.png", { maxDiffPixelRatio: 0.01 })
    })
  })
}
