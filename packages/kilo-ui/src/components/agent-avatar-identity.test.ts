import { describe, expect, test } from "bun:test"
import { COLORS, identity, palette } from "./agent-avatar-identity"

describe("agent avatar identity", () => {
  test("uses the same identity for the same participant", () => {
    expect(identity("ses_agent-one")).toEqual(identity("ses_agent-one"))
    expect(identity("ses_agent-one").cells).not.toEqual(identity("ses_agent-two").cells)
  })

  test("keeps unknown participants neutral", () => {
    expect(identity("").color).toBeUndefined()
    expect(identity("unknown")).toEqual(identity(""))
    expect(identity("  ")).toEqual(identity(""))
    expect(identity("main").color).toBeNumber()
  })

  test("produces visible symmetric patterns within the avatar", () => {
    for (const id of ["main", "ses_agent-one", "ses_agent-two", "participant", ""]) {
      const avatar = identity(id)
      expect(avatar.cells.length).toBeGreaterThan(0)
      for (const cell of avatar.cells) {
        expect(cell).toBeGreaterThanOrEqual(0)
        expect(cell).toBeLessThan(25)
        expect([0, 4, 20, 24]).not.toContain(cell)
        expect(avatar.cells).toContain(Math.floor(cell / 5) * 5 + 4 - (cell % 5))
      }
    }
  })

  test("gives the first siblings distinct colors and keeps earlier assignments stable", () => {
    const ids = Array.from({ length: COLORS + 3 }, (_, index) => `ses_sibling_${index}`)
    const colors = palette(ids)
    expect(new Set(ids.slice(0, COLORS).map((id) => colors.get(id))).size).toBe(COLORS)
    for (const id of ids) expect(colors.get(id)).toBeNumber()
    // Adding a later sibling never changes the color of an earlier one.
    const fewer = palette(ids.slice(0, 5))
    for (const id of ids.slice(0, 5)) expect(fewer.get(id)).toBe(colors.get(id))
    expect(palette(["", "unknown", "ses_x"]).get("")).toBeUndefined()
  })

  test("draws one connected glyph with a bounded size", () => {
    for (let index = 0; index < 200; index++) {
      const cells = identity(`ses_${index}`).cells
      const lit = new Set(cells)
      expect(cells.length).toBeGreaterThanOrEqual(7)
      expect(cells.length).toBeLessThanOrEqual(18)
      const seen = new Set([cells[0]])
      const queue = [cells[0]]
      while (queue.length > 0) {
        const cell = queue.pop()!
        const near = [cell - 5, cell + 5, cell % 5 > 0 ? cell - 1 : -1, cell % 5 < 4 ? cell + 1 : -1]
        for (const next of near) {
          if (!lit.has(next) || seen.has(next)) continue
          seen.add(next)
          queue.push(next)
        }
      }
      expect(seen.size).toBe(cells.length)
    }
  })
})
