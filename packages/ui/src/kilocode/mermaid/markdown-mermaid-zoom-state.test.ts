import { describe, expect, test } from "bun:test"
import { clampZoom, MAX_ZOOM, MIN_ZOOM, zoomBy, zoomLabel } from "./markdown-mermaid-zoom-state"

describe("mermaid zoom state", () => {
  test("clamps zoom to the supported range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  test("falls back to 100% for a non-finite value", () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
  })

  test("wheel up magnifies and wheel down shrinks", () => {
    expect(zoomBy(1, -1)).toBeGreaterThan(1)
    expect(zoomBy(1, 1)).toBeLessThan(1)
    expect(zoomBy(MAX_ZOOM, -1)).toBe(MAX_ZOOM)
    expect(zoomBy(MIN_ZOOM, 1)).toBe(MIN_ZOOM)
  })

  test("formats the zoom percentage", () => {
    expect(zoomLabel(1)).toBe("100%")
    expect(zoomLabel(1.5)).toBe("150%")
    expect(zoomLabel(0.25)).toBe("25%")
  })
})
