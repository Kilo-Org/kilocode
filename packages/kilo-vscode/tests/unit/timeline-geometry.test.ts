import { describe, expect, it } from "bun:test"
import { geometry, hit, navigate } from "../../webview-ui/src/utils/timeline/geometry"

describe("timeline geometry", () => {
  const bars = [
    { bg: "blue", width: 3, height: 4 },
    { bg: "red", width: 5, height: 8 },
    { bg: "blue", width: 2, height: 6 },
  ]

  it("preserves visual positions while grouping paths by color", () => {
    const result = geometry(bars, 10)

    expect(result.width).toBe(13)
    expect(result.items.map((item) => [item.idx, item.x])).toEqual([
      [0, 0],
      [1, 4],
      [2, 10],
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.paths.map((path) => path.bg)).toEqual(["blue", "red"])
    expect(result.paths[0]!.d).toContain("M0,10")
    expect(result.paths[0]!.d).toContain("M10,10")
    expect(result.paths[1]!.d).toContain("M4,10")
  })

  it("hit tests bars but not their gaps", () => {
    const items = geometry(bars, 10).items

    expect(hit(items, 0)).toBe(0)
    expect(hit(items, 2.99)).toBe(0)
    expect(hit(items, 3)).toBe(-1)
    expect(hit(items, 4)).toBe(1)
    expect(hit(items, 12)).toBe(-1)
  })

  it("navigates in visual order with bounded endpoints", () => {
    expect(navigate(-1, 3, "ArrowRight")).toBe(0)
    expect(navigate(1, 3, "ArrowLeft")).toBe(0)
    expect(navigate(2, 3, "ArrowRight")).toBe(2)
    expect(navigate(1, 3, "Home")).toBe(0)
    expect(navigate(1, 3, "End")).toBe(2)
    expect(navigate(1, 3, "Escape")).toBe(1)
    expect(navigate(0, 0, "ArrowRight")).toBe(-1)
  })
})
