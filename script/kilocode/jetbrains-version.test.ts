// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { compare, parse, previous } from "./jetbrains-version"

describe("parse", () => {
  test("accepts releases and release candidates", () => {
    expect(parse("7.3.13")).toEqual({ major: 7, minor: 3, patch: 13, rc: undefined })
    expect(parse("7.3.13-rc.0")).toEqual({ major: 7, minor: 3, patch: 13, rc: 0 })
  })

  test("refuses other forms", () => {
    const refused = ["7.3", "v7.3.13", "07.3.13", "7.3.13-rc.01", "7.3.13-beta.1", "7.3.13+1", " 7.3.13"]
    for (const text of [...refused, "9007199254740993.0.0"]) expect(parse(text)).toBeUndefined()
  })
})

describe("compare", () => {
  const order = ["7.2.9", "7.3.0-rc.1", "7.3.0-rc.2", "7.3.0-rc.10", "7.3.0", "7.3.1-rc.1", "7.10.0"]
  test("sorts numerically, a release after its candidates", () => {
    const shuffled = [...order].reverse()
    expect(shuffled.sort((a, b) => compare(parse(a)!, parse(b)!))).toEqual(order)
    expect(compare(parse("7.3.0")!, parse("7.3.0")!)).toBe(0)
  })
})

describe("previous", () => {
  const tags = [
    "jetbrains/v7.2.9",
    "jetbrains/v7.3.0-rc.1",
    "jetbrains/v7.3.0-rc.2",
    "jetbrains/v7.3.0",
    "jetbrains/v7.3.1-rc.1",
    "jetbrains/v7.10.0-rc.1",
    "jetbrains/vnot-a-version",
  ]

  test("a release starts from the newest earlier release", () => {
    expect(previous("7.3.1", "stable", tags)).toBe("jetbrains/v7.3.0")
    expect(previous("7.3.0", "stable", tags)).toBe("jetbrains/v7.2.9")
    expect(previous("7.2.9", "stable", tags)).toBeUndefined()
  })

  test("a candidate starts from the newest earlier candidate of the same version", () => {
    expect(previous("7.3.0-rc.3", "rc", tags)).toBe("jetbrains/v7.3.0-rc.2")
    expect(previous("7.3.1-rc.2", "rc", tags)).toBe("jetbrains/v7.3.1-rc.1")
  })

  test("a first candidate starts from the newest earlier release", () => {
    expect(previous("7.4.0-rc.1", "rc", tags)).toBe("jetbrains/v7.3.0")
    expect(previous("7.3.1-rc.1", "rc", tags)).toBe("jetbrains/v7.3.0")
    expect(previous("7.2.9-rc.1", "rc", tags)).toBeUndefined()
  })

  test("refuses an invalid version", () => {
    expect(() => previous("7.3", "stable", tags)).toThrow("Invalid version: 7.3")
  })
})
