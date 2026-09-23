import { describe, expect, test } from "bun:test"
import { infoAlign, infoSide } from "../../webview-ui/agent-manager/info-side"

describe("economics info popover side", () => {
  test("opens upward when the space above the icon clears the container", () => {
    // Icon 300px down the viewport, 90px tall popover, container starts at 120px.
    expect(infoSide(300, 90, 120)).toBe("top")
  })

  test("flips below when the popover would overflow the top of the container", () => {
    // First hero row: only 40px between the icon and the panel header.
    expect(infoSide(160, 90, 120)).toBe("bottom")
  })

  test("accounts for the gap at the exact boundary", () => {
    expect(infoSide(216, 90, 120)).toBe("top")
    expect(infoSide(215, 90, 120)).toBe("bottom")
    expect(infoSide(215, 90, 120, 5)).toBe("top")
  })

  test("flips below at the very top of the viewport when there is no container", () => {
    expect(infoSide(20, 90, 0)).toBe("bottom")
  })
})

describe("economics info popover alignment", () => {
  test("anchors to the badge's right edge when the popover fits", () => {
    // Badge at x=700, 340px popover, visible area starts at x=280: the popover's
    // left edge lands at 364, well inside the panel.
    expect(infoAlign(700, 340, 280)).toBe("end")
  })

  test("anchors to the left when right-anchoring would overflow the left edge", () => {
    // Leftmost hero card: badge at x=420 leaves only 140px before the panel edge.
    expect(infoAlign(420, 340, 280)).toBe("start")
  })

  test("accounts for the overhang past the badge at the boundary", () => {
    expect(infoAlign(616, 340, 280)).toBe("end")
    expect(infoAlign(615, 340, 280)).toBe("start")
    expect(infoAlign(615, 340, 280, 5)).toBe("end")
  })
})
