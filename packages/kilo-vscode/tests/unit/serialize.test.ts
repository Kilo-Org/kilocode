import { describe, expect, it } from "bun:test"
import { serialize } from "../../src/util/serialize"

describe("serialize", () => {
  it("uses compact tags to distinguish numbers, BigInts, and arrays", () => {
    expect(serialize([0, -0, 0n, [1, 2, 3]])).toBe('[0,-0,[0,"0"],[[],1,2,3]]')
    expect(serialize([0n])).not.toBe(serialize([[0, "0"]]))
  })

  it("preserves text boundaries and exact nested BigInt values", () => {
    expect(serialize(["a:b", "c"])).not.toBe(serialize(["a", "b:c"]))
    expect(serialize([9007199254740993n, [42n, -0]])).toBe('[[0,"9007199254740993"],[[],[0,"42"],-0]]')
  })
})
