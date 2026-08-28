import { describe, expect, it } from "bun:test"
import { edge } from "../../webview-ui/src/sidebar-position"

const view = { screenX: 144, outerWidth: 1440, innerWidth: 299 }

describe("sidebar position", () => {
  it.each([
    [0, 192, "left"],
    [149.5, 341.5, "left"],
    [299, 491, "left"],
    [0, 1285, "right"],
    [149.5, 1434.5, "right"],
    [299, 1584, "right"],
  ] as const)("resolves client %s at screen %s to the %s edge", (client, screen, side) => {
    expect(edge({ clientX: client, screenX: screen }, view)).toBe(side)
  })

  it("uses the window origin on a monitor with negative coordinates", () => {
    const host = { ...view, screenX: -1440 }
    expect(edge({ clientX: 149.5, screenX: -1242.5 }, host)).toBe("left")
    expect(edge({ clientX: 149.5, screenX: -149.5 }, host)).toBe("right")
  })

  it("keeps the outer edge when the sidebar is wider than half the window", () => {
    const host = { screenX: 0, outerWidth: 1440, innerWidth: 1000 }
    expect(edge({ clientX: 950, screenX: 998 }, host)).toBe("left")
    expect(edge({ clientX: 50, screenX: 490 }, host)).toBe("right")
  })

  it("handles pointer coordinates from a zoomed webview", () => {
    expect(edge({ clientX: 149.5703125, screenX: 1404.484375 }, view)).toBe("right")
    expect(edge({ clientX: 149.5, screenX: 381 }, view)).toBe("left")
  })

  it("ignores unavailable or invalid geometry", () => {
    const event = { clientX: 149.5, screenX: 341.5 }
    expect(edge(event, { ...view, outerWidth: 0 })).toBeUndefined()
    expect(edge(event, { ...view, innerWidth: 0 })).toBeUndefined()
    expect(edge(event, { ...view, outerWidth: Number.NaN })).toBeUndefined()
    expect(edge(event, { ...view, innerWidth: Number.POSITIVE_INFINITY })).toBeUndefined()
    expect(edge({ ...event, screenX: -10000 }, view)).toBeUndefined()
    expect(edge({ ...event, screenX: 10000 }, view)).toBeUndefined()
    expect(edge({ ...event, clientX: Number.NaN }, view)).toBeUndefined()
  })
})
