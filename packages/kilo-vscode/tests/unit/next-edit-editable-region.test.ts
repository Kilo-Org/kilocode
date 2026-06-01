import { MAX_EDITABLE_REGION_LINES } from "../../src/services/autocomplete/next-edit/constants"
import { computeEditableRegion } from "../../src/services/autocomplete/next-edit/editableRegion"

describe("computeEditableRegion", () => {
  it("returns the default [-5, +10] window around the cursor", () => {
    const r = computeEditableRegion({ cursorLine: 20, totalLines: 100 })
    expect(r.startLine).toBe(15)
    expect(r.endLine).toBe(30)
  })

  it("clips at file start", () => {
    const r = computeEditableRegion({ cursorLine: 2, totalLines: 50 })
    expect(r.startLine).toBe(0)
    expect(r.endLine).toBe(12)
  })

  it("clips at file end", () => {
    const r = computeEditableRegion({ cursorLine: 49, totalLines: 50 })
    expect(r.endLine).toBe(49)
    expect(r.startLine).toBe(44)
  })

  it("caps the region at MAX_EDITABLE_REGION_LINES", () => {
    const r = computeEditableRegion({
      cursorLine: 100,
      totalLines: 1000,
      topMargin: 100,
      bottomMargin: 100,
    })
    expect(r.endLine - r.startLine + 1).toBeLessThanOrEqual(MAX_EDITABLE_REGION_LINES)
  })

  it("handles an empty document gracefully", () => {
    const r = computeEditableRegion({ cursorLine: 0, totalLines: 0 })
    expect(r).toEqual({ startLine: 0, endLine: 0 })
  })
})
