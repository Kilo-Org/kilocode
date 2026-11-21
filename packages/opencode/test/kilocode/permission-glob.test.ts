import { test, expect, describe } from "bun:test"
import { regexToGlobs } from "../../src/kilocode/permission-glob"

describe("regexToGlobs", () => {
  test("suffix anchor becomes one wildcard arm", () => {
    expect(regexToGlobs("\\.md$")).toEqual(["*.md"])
  })

  test("alternation with an optional last character becomes every arm", () => {
    expect(regexToGlobs(".*\\.tsx?$")).toEqual(["*.ts", "*.tsx"])
  })

  test("prefix anchor keeps the arm unanchored at the start", () => {
    expect(regexToGlobs("^(src|test)/")).toEqual(["src/*", "test/*"])
  })

  test("nested group is rejected", () => {
    expect(regexToGlobs("(a|(b))\\.md$")).toBeNull()
  })

  test("a character class is rejected", () => {
    expect(regexToGlobs("[a-z]\\.md$")).toBeNull()
  })

  test("a repeated atom is rejected", () => {
    expect(regexToGlobs("a+\\.md$")).toBeNull()
  })

  test("a word-boundary escape is rejected", () => {
    expect(regexToGlobs("\\.md\\b")).toBeNull()
  })

  test("an empty pattern is rejected", () => {
    expect(regexToGlobs("")).toBeNull()
  })

  test("an anchored pattern of only digits is rejected", () => {
    expect(regexToGlobs("^123$")).toBeNull()
  })

  test("an unanchored numeric pattern stays a wildcard arm", () => {
    expect(regexToGlobs("123")).toEqual(["*123*"])
  })
})
