import { describe, expect, test } from "bun:test"
import { kind, parse, report, verify } from "./outdated"

const table = `bun outdated v1.3.14 (0d9b296a)
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| Package                           | Current              | Update               | Latest               | Workspace              |
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| zod                               | 3.25.76              | 3.25.76              | 4.6.5                | kilo-code              |
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| ws                                | 8.21.0               | 8.21.0               | 8.22.0 *             | kilo-code              |
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| @babel/core (dev)                 | 7.29.6               | 7.29.7               | 7.29.7               | kilo-code              |
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| solid-js                          | 1.9.12               | 1.9.12               | 1.10.0               | catalog (@kilocode/kilo-ui) |
|-----------------------------------|----------------------|----------------------|----------------------|------------------------|
| chromium-bidi                     | 0.8.0                | 0.8.0                | 0.8.0 *              | kilo-code              |
`

describe("outdated parse", () => {
  test("reads rows and skips the header, separators and the version banner", () => {
    expect(parse(table).map((row) => row.name)).toEqual(["zod", "ws", "@babel/core", "solid-js", "chromium-bidi"])
  })

  test("strips the dev suffix and the trailing marker", () => {
    const rows = parse(table)
    expect(rows.find((row) => row.name === "@babel/core")?.latest).toBe("7.29.7")
    expect(rows.find((row) => row.name === "ws")?.latest).toBe("8.22.0")
  })

  test("flags catalog rows", () => {
    const rows = parse(table)
    expect(rows.find((row) => row.name === "solid-js")?.catalog).toBe(true)
    expect(rows.find((row) => row.name === "zod")?.catalog).toBe(false)
  })

  test("returns nothing for empty output", () => {
    expect(parse("")).toEqual([])
  })
})

describe("outdated kind", () => {
  test("classifies the gap", () => {
    expect(kind("3.25.76", "4.6.5")).toBe("major")
    expect(kind("8.21.0", "8.22.0")).toBe("minor")
    expect(kind("7.29.6", "7.29.7")).toBe("patch")
  })

  test("ignores equal, older and non-semver versions", () => {
    expect(kind("0.8.0", "0.8.0")).toBeUndefined()
    expect(kind("2.0.0", "1.9.9")).toBeUndefined()
    expect(kind("1.0.0", "1.0.0-beta.1")).toBeUndefined()
    expect(kind("github:a/b", "1.0.0")).toBeUndefined()
  })
})

describe("outdated report", () => {
  test("is empty when nothing is behind", () => {
    expect(report(parse(table).filter((row) => row.name === "chromium-bidi"))).toEqual({ count: 0, text: "" })
  })

  test("counts each level and labels root catalog entries", () => {
    const out = report(parse(table), { url: "https://example.test/run" })
    expect(out.count).toBe(4)
    expect(out.text).toContain("1 major, 2 minor, 1 patch")
    expect(out.text).toContain("`zod` 3.25.76 -> 4.6.5 (kilo-code)")
    expect(out.text).toContain("`solid-js` 1.9.12 -> 1.10.0 (@kilocode/kilo-ui) [root catalog]")
    expect(out.text).toContain("<https://example.test/run|Workflow run>")
  })

  test("lists minor bumps but only counts patch bumps", () => {
    const out = report(parse(table))
    expect(out.text).toContain("`ws` 8.21.0 -> 8.22.0")
    expect(out.text).not.toContain("`@babel/core`")
    expect(out.text).toContain("1 patch update not listed.")
  })

  test("the full report lists patch updates and has no cap note", () => {
    const out = report(parse(table), { patch: true })
    expect(out.text).toContain("`@babel/core` 7.29.6 -> 7.29.7")
    expect(out.text).not.toContain("not listed")
    expect(out.text).not.toContain("more (see the job summary)")
  })

  test("uses the plural when several patch updates are not listed", () => {
    const rows = [
      ...parse(table),
      { name: "extra", current: "1.0.0", latest: "1.0.1", where: "kilo-code", catalog: false },
    ]
    expect(report(rows).text).toContain("2 patch updates not listed.")
  })

  test("explains the root catalog label only when a catalog row is printed", () => {
    const rows = parse(table)
    expect(report(rows).text).toContain("[root catalog] entries are pinned")
    expect(report(rows.filter((row) => !row.catalog)).text).not.toContain("[root catalog] entries are pinned")
  })

  test("drops the catalog note when the capped section hides the catalog row", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `major${i}`,
        current: "1.0.0",
        latest: "2.0.0",
        where: "kilo-code",
        catalog: false,
      })),
      { name: "cat", current: "1.0.0", latest: "1.1.0", where: "catalog (kilo-code)", catalog: true },
    ]
    // The catalog row is a minor; the minor section is printed, so the note stays.
    expect(report(rows, { limit: 2 }).text).toContain("[root catalog] entries are pinned")
    // With a zero cap nothing is printed, so neither label nor note appears.
    const none = report(rows, { limit: 0 }).text
    expect(none).not.toContain("[root catalog]")
  })

  test("caps each section at the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      name: `pkg${i}`,
      current: "1.0.0",
      latest: "2.0.0",
      where: "kilo-code",
      catalog: false,
    }))
    const out = report(rows, { limit: 2 })
    expect(out.text).toContain("`pkg1`")
    expect(out.text).not.toContain("`pkg2`")
    expect(out.text).toContain("...and 3 more")
  })
})

describe("outdated verify", () => {
  test("accepts a clean banner-only output", () => {
    expect(() => verify("bun outdated v1.3.14 (0d9b296a)\n", [])).not.toThrow()
  })

  test("accepts a parsed table", () => {
    expect(() => verify(table, parse(table))).not.toThrow()
  })

  test("rejects an error line even though bun exits 0", () => {
    expect(() => verify("bun outdated v1.3.14\nerror: missing lockfile, nothing outdated\n", [])).toThrow(
      "bun outdated failed",
    )
  })

  test("rejects a table that no longer parses", () => {
    const drift = table.replaceAll("|\n", "| extra |\n")
    expect(() => verify(drift, parse(drift))).toThrow("format changed")
  })
})
