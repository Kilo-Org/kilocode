import { describe, expect, test } from "bun:test"
import path from "path"
import { TestGroup } from "../../script/kilocode/test-groups"

const root = path.resolve(import.meta.dir, "..")
const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: root })))
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !TestGroup.excluded.has(file))
  .toSorted()

describe("test groups", () => {
  test("assign every eligible file exactly once", () => {
    const result = TestGroup.resolve(all)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const assigned = result.groups.flatMap((group) => group.files)
    expect(assigned.toSorted()).toEqual(all)
    expect(new Set(assigned).size).toBe(all.length)
    const domains = result.groups.filter((group) => group.mode === "domain")
    expect(domains.map((group) => group.name)).toEqual(["foundation"])
    expect(domains[0].files.length).toBeGreaterThan(0)
  })

  test("reports unassigned files", () => {
    const result = TestGroup.resolve(["one.test.ts", "two.test.ts"], [{ name: "one", patterns: ["one.test.ts"] }])
    expect(result).toEqual({ ok: false, error: "Unassigned test files:\n- two.test.ts" })
  })

  test("reports duplicate membership", () => {
    const result = TestGroup.resolve(
      ["one.test.ts"],
      [
        { name: "first", patterns: ["*.test.ts"] },
        { name: "second", patterns: ["one.test.ts"] },
      ],
    )
    expect(result).toEqual({
      ok: false,
      error: "Test files assigned to multiple groups:\n- one.test.ts: first, second",
    })
  })

  test("reports stale patterns", () => {
    const result = TestGroup.resolve(["one.test.ts"], [{ name: "one", patterns: ["one.test.ts", "gone.test.ts"] }])
    expect(result).toEqual({
      ok: false,
      error: "Patterns matching no test files:\n- one: gone.test.ts",
    })
  })
})
