import { describe, expect, it } from "bun:test"
import { COLORS, identity, palette } from "../src/components/agent-avatar-identity"

const spawn = (count: number) => Array.from({ length: count }, (_, index) => `ses_${index}`)

const pair = (avatar: { color: number | undefined; cells: number[] }) => `${avatar.color}:${avatar.cells.join(",")}`

describe("agent avatar palette", () => {
  it("keeps color and glyph pairs unique for 49 siblings", () => {
    const ids = spawn(49)
    const assigned = palette(ids)

    expect(assigned.size).toBe(49)
    expect(new Set([...assigned.values()].map(pair)).size).toBe(49)
    for (const id of ids) {
      expect(assigned.get(id)?.cells).toEqual(identity(id).cells)
    }
  })

  it("recolors the second sibling that repeats both color and glyph", () => {
    const ids = spawn(49)
    const assigned = palette(ids)
    const glyph = identity("ses_31").cells

    expect(identity("ses_48").cells).toEqual(glyph)
    expect(assigned.get("ses_31")).toEqual({ color: 6, cells: glyph })
    expect(assigned.get("ses_48")).toEqual({ color: 7, cells: glyph })
  })

  it("does not recolor earlier siblings when a sibling is appended", () => {
    const before = palette(spawn(48))
    const after = palette(spawn(49))

    for (const id of spawn(48)) {
      expect(after.get(id)).toEqual(before.get(id))
    }
  })

  it("uses a different glyph when a symmetric glyph already uses every hue", () => {
    // These IDs all generate the same rotationally symmetric glyph, so rotation cannot distinguish the ninth.
    const ids = [
      "ses_11179",
      "ses_11856",
      "ses_12156",
      "ses_12178",
      "ses_12747",
      "ses_12905",
      "ses_14006",
      "ses_14271",
      "ses_16549",
    ]
    const assigned = palette(ids)
    const glyph = identity(ids[0]).cells
    const shown = (id: string) => {
      const avatar = assigned.get(id)
      if (!avatar) throw new Error(`Missing palette entry for ${id}`)
      return avatar
    }

    expect(ids.map((id) => identity(id).cells)).toEqual(ids.map(() => glyph))
    expect(new Set(ids.slice(0, COLORS).map((id) => shown(id).color)).size).toBe(COLORS)
    expect(ids.slice(0, COLORS).map((id) => shown(id).cells)).toEqual(Array.from({ length: COLORS }, () => glyph))
    expect(shown(ids[COLORS]).cells).not.toEqual(glyph)
    expect(new Set(ids.map((id) => pair(shown(id)))).size).toBe(ids.length)
  })

  it("leaves unknown sessions to the neutral fallback", () => {
    const assigned = palette(["unknown", "", "ses_0"])

    expect([...assigned.keys()]).toEqual(["ses_0"])
    expect(identity("unknown").color).toBeUndefined()
    expect(identity("").cells).toEqual(identity("unknown").cells)
  })
})
