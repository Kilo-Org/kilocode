import { describe, expect, test } from "bun:test"
import { TestBatch } from "../../script/kilocode/test-batch"
import allowlist from "../../script/kilocode/test-batch.json"

const size = (file: string) => file.length

function files(count: number, prefix = "pure") {
  return Array.from({ length: count }, (_, index) => `${prefix}/${index}.test.ts`)
}

describe("TestBatch.plan", () => {
  const many = files(80)
  const allow = new Set(many)

  test("batched groups and isolated files together cover the input exactly once", () => {
    const mixed = [...many, ...files(10, "heavy")]
    const plan = TestBatch.plan(mixed, allow, 4, size)
    const seen = [...plan.groups.flat(), ...plan.isolated].sort()
    expect(seen).toEqual(mixed.slice().sort())
  })

  test("only allowlisted files are batched", () => {
    const plan = TestBatch.plan([...many, ...files(10, "heavy")], allow, 4, size)
    for (const file of plan.groups.flat()) expect(allow.has(file)).toBe(true)
    expect(plan.isolated).toEqual(files(10, "heavy"))
  })

  test("small selections are left fully isolated", () => {
    // Under 4 * concurrency eligible files the spawn saving is a few seconds
    // while the straggler risk is worst, so batching should not kick in.
    const few = files(15)
    const plan = TestBatch.plan(few, new Set(few), 4, size)
    expect(plan.groups).toEqual([])
    expect(plan.isolated).toEqual(few)
  })

  test("group count is at least the lane count and scales with the target size", () => {
    const plan = TestBatch.plan(many, allow, 4, size)
    expect(plan.groups.length).toBeGreaterThanOrEqual(4)
    expect(plan.groups.length).toBeLessThanOrEqual(Math.ceil(many.length / 2))
  })

  test("no group holds a single file", () => {
    for (const concurrency of [1, 2, 4, 8]) {
      const plan = TestBatch.plan(many, allow, concurrency, size)
      for (const group of plan.groups) expect(group.length).toBeGreaterThan(1)
    }
  })

  test("allowlist entries missing from the run are reported as stale", () => {
    const plan = TestBatch.plan(many, new Set([...many, "gone/away.test.ts"]), 4, size)
    expect(plan.stale).toEqual(["gone/away.test.ts"])
  })

  test("a partial run does not report the files it simply did not select as stale", () => {
    // A shard or a pattern filter runs a fraction of the allowlist. Only entries
    // absent from the whole suite are drift; the rest are just not in this run.
    const shard = many.slice(0, 20)
    const plan = TestBatch.plan(shard, new Set([...many, "gone/away.test.ts"]), 4, size, many)
    expect(plan.stale).toEqual(["gone/away.test.ts"])
  })

  test("nothing is batched when no file is allowlisted", () => {
    const plan = TestBatch.plan(many, new Set(), 4, size)
    expect(plan.groups).toEqual([])
    expect(plan.isolated).toEqual(many)
  })
})

describe("TestBatch.allowlist", () => {
  test("the checked-in allowlist parses and is non-trivial", () => {
    const parsed = TestBatch.allowlist(allowlist)
    expect(parsed.size).toBe(allowlist.length)
    expect(parsed.size).toBeGreaterThan(100)
    for (const file of parsed) expect(file.endsWith(".test.ts")).toBe(true)
  })

  test("malformed allowlists are rejected rather than silently ignored", () => {
    expect(() => TestBatch.allowlist({})).toThrow()
    expect(() => TestBatch.allowlist(["a.test.ts", 3])).toThrow()
    expect(() => TestBatch.allowlist(["a.test.ts", "a.test.ts"])).toThrow()
    expect(() => TestBatch.allowlist([""])).toThrow()
  })
})
