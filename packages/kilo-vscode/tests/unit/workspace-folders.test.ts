import { describe, expect, it } from "bun:test"
import * as path from "path"
import { folderFor, within } from "../../src/workspace-folders"

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
