import { describe, expect, test } from "bun:test"
import { TestShard } from "../../script/kilocode/test-shard"

describe("test shard", () => {
  test("parses valid shard specifications", () => {
    expect(TestShard.parse()).toEqual({ ok: true, value: undefined })
    expect(TestShard.parse("2/3")).toEqual({ ok: true, value: { index: 2, total: 3 } })
  })

  test("rejects invalid shard specifications", () => {
    expect(TestShard.parse("0/2").ok).toBe(false)
    expect(TestShard.parse("3/2").ok).toBe(false)
    expect(TestShard.parse("1/0").ok).toBe(false)
    expect(TestShard.parse("one/two").ok).toBe(false)
    expect(TestShard.parse("1/999999999999999999999").ok).toBe(false)
  })

  test("orders the heaviest files first with stable ties", () => {
    const weights = new Map([
      ["small.test.ts", 1],
      ["b.test.ts", 5],
      ["a.test.ts", 5],
    ])
    expect(TestShard.order([...weights.keys()], (file) => weights.get(file)!)).toEqual([
      "a.test.ts",
      "b.test.ts",
      "small.test.ts",
    ])
  })

  test("partitions every file once while balancing weights", () => {
    const weights = new Map([
      ["largest.test.ts", 8],
      ["large.test.ts", 7],
      ["medium.test.ts", 6],
      ["small.test.ts", 3],
    ])
    const groups = TestShard.split([...weights.keys()], (file) => weights.get(file)!, 2)
    expect(groups.flat().sort()).toEqual([...weights.keys()].sort())
    expect(groups.map((group) => group.reduce((sum, file) => sum + weights.get(file)!, 0))).toEqual([11, 13])
  })

  test("distributes zero-weight files across shards", () => {
    expect(TestShard.split(["a.test.ts", "b.test.ts"], () => 0, 2)).toEqual([["a.test.ts"], ["b.test.ts"]])
  })
})
