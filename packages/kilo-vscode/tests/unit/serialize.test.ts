import { describe, expect, it } from "bun:test"
import { serialize } from "../../src/util/serialize"

describe("serialize", () => {
  it("preserves text boundaries and nested tuples", () => {
    expect(serialize(["a:b", "c"])).not.toBe(serialize(["a", "b:c"]))
    expect(serialize(["a\0b", "c"])).not.toBe(serialize(["a", "b\0c"]))
    expect(serialize([["a", "b"]])).not.toBe(serialize(["a", "b"]))
  })

  it("preserves scalar types and exact BigInt values", () => {
    const values = [1, 1n, "1", null, undefined, "", true, "true", 0, -0, NaN, Infinity, -Infinity]
    expect(new Set(values.map((value) => serialize([value]))).size).toBe(values.length)
    expect(serialize([9007199254740992n])).not.toBe(serialize([9007199254740993n]))
  })
})
