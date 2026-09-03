import { describe, expect, it } from "bun:test"
import { serialize } from "../../src/util/serialize"

describe("serialize", () => {
  it("uses compact JSON while preserving text boundaries and nested tuples", () => {
    expect(serialize(["a:b", 3, true, null, ["c"]])).toBe('["a:b",3,true,null,["c"]]')
    expect(serialize(["a:b", "c"])).not.toBe(serialize(["a", "b:c"]))
  })

  it("preserves exact BigInt digits and negative zero", () => {
    expect(serialize([9007199254740993n, [42n, -0]])).toBe("[9007199254740993,[42,-0]]")
  })
})
