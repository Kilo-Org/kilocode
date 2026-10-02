import { describe, expect, it } from "bun:test"
import * as path from "path"
import { activeFolder, folderFor, relativeIn, within } from "../../src/workspace-folders"

const abs = (...parts: string[]) => path.resolve("/ws", ...parts)
const a = abs("a")
const b = abs("b")
const nested = abs("a", "pkg")

describe("within", () => {
  it("accepts the folder itself and its descendants", () => {
    expect(within(a, a)).toBe(true)
    expect(within(a, abs("a", "src", "x.ts"))).toBe(true)
  })

  it("rejects siblings that share a name prefix", () => {
    expect(within(a, abs("a-other", "x.ts"))).toBe(false)
    expect(within(a, b)).toBe(false)
  })
})

describe("folderFor", () => {
  it("returns the owning folder", () => {
    expect(folderFor(abs("b", "x.ts"), [a, b])).toBe(b)
  })

  it("prefers the deepest folder when folders nest", () => {
    expect(folderFor(abs("a", "pkg", "x.ts"), [a, nested])).toBe(nested)
    expect(folderFor(abs("a", "pkg", "x.ts"), [nested, a])).toBe(nested)
  })

  it("returns undefined outside every folder", () => {
    expect(folderFor(abs("c", "x.ts"), [a, b])).toBeUndefined()
  })
})

describe("activeFolder", () => {
  it("prefers an explicit pick", () => {
    expect(activeFolder({ roots: [a, b], picked: b, active: abs("a", "x.ts") })).toBe(b)
  })

  it("follows the active editor", () => {
    expect(activeFolder({ roots: [a, b], active: abs("b", "x.ts") })).toBe(b)
  })

  it("falls back to the last editor, then the first folder", () => {
    expect(activeFolder({ roots: [a, b], last: abs("b", "x.ts") })).toBe(b)
    expect(activeFolder({ roots: [a, b] })).toBe(a)
  })

  it("ignores an editor outside every folder", () => {
    expect(activeFolder({ roots: [a, b], active: abs("c", "x.ts"), last: abs("b", "y.ts") })).toBe(b)
  })

  it("ignores a pick that is no longer a workspace folder", () => {
    expect(activeFolder({ roots: [a], picked: b })).toBe(a)
  })

  it("is undefined without folders", () => {
    expect(activeFolder({ roots: [] })).toBeUndefined()
  })
})

describe("relativeIn", () => {
  it("is relative to the owning folder, without the folder name", () => {
    expect(relativeIn(abs("b", "src", "x.ts"), [a, b])).toBe("src/x.ts")
  })

  it("is undefined outside every folder", () => {
    expect(relativeIn(abs("c", "x.ts"), [a, b])).toBeUndefined()
  })
})
