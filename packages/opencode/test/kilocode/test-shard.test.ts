import { describe, expect, test } from "bun:test"
import { TestShard } from "../../script/kilocode/test-shard"
import { JunitDurations } from "../../script/kilocode/junit-durations"

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

describe("test shard durations", () => {
  test("extracts per-file durations from a merged junit body", () => {
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuites tests="6" failures="0" time="12.345">`,
      `  <testsuite name="test/foo.test.ts" file="test/foo.test.ts" tests="3" time="7.5">`,
      `    <testsuite name="describe a" file="test/foo.test.ts" tests="3" time="7.4">`,
      `      <testcase name="case 1" classname="describe a" time="0.001"/>`,
      `    </testsuite>`,
      `  </testsuite>`,
      `  <testsuite name="kilocode/bar.test.ts" tests="1" failures="1" errors="0" time="4.8">`,
      `    <testcase name="bar" classname="kilocode/bar.test.ts" time="4.8">`,
      `      <failure message="boom">x</failure>`,
      `    </testcase>`,
      `  </testsuite>`,
      `</testsuites>`,
    ].join("\n")
    expect(JunitDurations.parse(xml)).toEqual({
      "foo.test.ts": 7.5,
      "kilocode/bar.test.ts": 4.8,
    })
  })

  test("skips zero-time and malformed suites", () => {
    const xml = `<testsuites><testsuite name="a.test.ts" time="0"/></testsuites>`
    expect(JunitDurations.parse(xml)).toEqual({})
  })

  test("handles self-closing root and missing root", () => {
    expect(JunitDurations.parse("<testsuites/>")).toEqual({})
    expect(JunitDurations.parse("")).toEqual({})
    expect(JunitDurations.parse("<other/>")).toEqual({})
  })

  test("strips leading test/ and test\\ prefixes and converts separators to /", () => {
    const posix = `<testsuites><testsuite name="test/foo.test.ts" time="1.5"/><testsuite name="bar.test.ts" time="2.5"/></testsuites>`
    expect(JunitDurations.parse(posix)).toEqual({
      "foo.test.ts": 1.5,
      "bar.test.ts": 2.5,
    })
    const windows = String.raw`<testsuites><testsuite name="test\foo.test.ts" time="1.5"/><testsuite name="bar.test.ts" time="2.5"/></testsuites>`
    expect(JunitDurations.parse(windows)).toEqual({
      "foo.test.ts": 1.5,
      "bar.test.ts": 2.5,
    })
    // Nested backslashes (Windows runner paths) are normalized to / as well.
    const deep = String.raw`<testsuites><testsuite name="test\kilocode\nested\foo.test.ts" time="4"/></testsuites>`
    expect(JunitDurations.parse(deep)).toEqual({ "kilocode/nested/foo.test.ts": 4 })
  })

  test("walks past a self-closing <testsuite/> to the next sibling", () => {
    // Regression: cursor was being advanced by one extra char past the
    // closing `>` of a self-closing tag, causing the next <testsuite to be
    // missed entirely.
    const xml = `<testsuites><testsuite name="a.test.ts" time="1"/><testsuite name="b.test.ts" time="2"/><testsuite name="c.test.ts" time="3"/></testsuites>`
    expect(JunitDurations.parse(xml)).toEqual({
      "a.test.ts": 1,
      "b.test.ts": 2,
      "c.test.ts": 3,
    })
  })

  test("terminates cleanly when a non-self-closing suite has no closing tag", () => {
    // Regression: a missing `</testsuite>` in the body used to make the
    // parser advance `cursor` to 11 and re-find the same open tag forever.
    // The fix preserves the -1 sentinel from indexOf so the existing
    // not-found guard clamps `cursor` to rootCloseStart instead. Without
    // the fix, `indexOf("</testsuite>")` returns -1 here (the closing `>`
    // of `</testsuite>` doesn't match the `s` of `</testsuites>`), so the
    // old `next + "</testsuite>".length` arithmetic produced 11 and the
    // same open tag matched again on the next iteration.
    //
    // The open tag's attributes are parsed before the close lookup, so
    // `bad.test.ts` is still recorded. The point of the test is that
    // `parse` returns at all rather than hanging.
    const xml = `<testsuites><testsuite name="ok.test.ts" time="1"/><testsuite name="bad.test.ts" time="2"><testcase name="x"/></testsuites>`
    const result = JunitDurations.parse(xml)
    expect(result["ok.test.ts"]).toBe(1)
    expect(typeof result["bad.test.ts"]).toBe("number")
  })

  test("does not strip test/ when it is a real file name (not a cwd prefix)", () => {
    const xml = `<testsuites><testsuite name="test.test.ts" time="3"/></testsuites>`
    expect(JunitDurations.parse(xml)).toEqual({ "test.test.ts": 3 })
  })

  test("skips prolog, comments, and doctype before the root element", () => {
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!-- a comment -->`,
      `<!DOCTYPE foo SYSTEM "foo.dtd">`,
      `<testsuites>`,
      `  <testsuite name="a.test.ts" time="2.5"/>`,
      `</testsuites>`,
    ].join("\n")
    expect(JunitDurations.parse(xml)).toEqual({ "a.test.ts": 2.5 })
  })

  test("jumps past nested describe-level testsuites within each top-level file", () => {
    const xml = [
      `<testsuites>`,
      `  <testsuite name="test/x.test.ts" file="test/x.test.ts" tests="3" time="9.9">`,
      `    <testsuite name="describe block" file="test/x.test.ts" time="9.8">`,
      `      <testcase name="t" classname="describe block" time="9.7">`,
      `        <failure message="boom">inner</failure>`,
      `      </testcase>`,
      `    </testsuite>`,
      `  </testsuite>`,
      `  <testsuite name="test/y.test.ts" file="test/y.test.ts" tests="1" time="1.1"/>`,
      `</testsuites>`,
    ].join("\n")
    expect(JunitDurations.parse(xml)).toEqual({
      "x.test.ts": 9.9,
      "y.test.ts": 1.1,
    })
  })

  test("combines durations keeping the slowest observation per file", () => {
    const a = { "a.test.ts": 5, "b.test.ts": 3 }
    const b = { "a.test.ts": 4, "b.test.ts": 6, "c.test.ts": 1 }
    expect(TestShard.combineDurations(a, b)).toEqual({
      "a.test.ts": 5,
      "b.test.ts": 6,
      "c.test.ts": 1,
    })
  })

  test("ignores non-finite and non-positive entries when combining", () => {
    expect(TestShard.combineDurations({ "a.test.ts": Number.NaN }, { "a.test.ts": -1 })).toEqual({})
  })

  test("weightFromDurations prefers observed seconds for known files", () => {
    const weight = TestShard.weightFromDurations(
      { "small.test.ts": 1, "big.test.ts": 100 },
      () => 0,
    )
    expect(weight("small.test.ts")).toBe(1)
    expect(weight("big.test.ts")).toBe(100)
  })

  test("weightFromDurations scales fallback weight into seconds", () => {
    // Observed durations 8s and 2s, matching fallback weights 8000 and 2000 bytes.
    // Scale = (8 + 2) / (8000 + 2000) = 0.001 sec/byte. The 5000-byte c.test.ts
    // has no observation, so it inherits the byte-to-seconds scale.
    const weight = TestShard.weightFromDurations(
      { "a.test.ts": 8, "b.test.ts": 2 },
      (file) => (file === "a.test.ts" ? 8000 : file === "b.test.ts" ? 2000 : 5000),
    )
    expect(weight("c.test.ts")).toBe(5)
  })

  test("weightFromDurations falls back to raw weight when no history exists", () => {
    const fallback = () => 42
    expect(TestShard.weightFromDurations({}, fallback)).toBe(fallback)
  })

  test("weightFromDurations avoids divide-by-zero when observed fallback is zero", () => {
    const weight = TestShard.weightFromDurations(
      { "a.test.ts": 10 },
      () => 0,
    )
    expect(weight("b.test.ts")).toBe(0)
    expect(weight("a.test.ts")).toBe(10)
  })
})