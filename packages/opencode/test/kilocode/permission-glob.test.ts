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

  test("an unanchored empty alternative matches every path", () => {
    expect(regexToGlobs("(|a)")).toEqual(["*", "*a*"])
  })

  test("a start-anchored empty alternative matches every path", () => {
    expect(regexToGlobs("^(|a)")).toEqual(["*", "a*"])
  })

  test("an end-anchored empty alternative matches every path", () => {
    expect(regexToGlobs("(|a)$")).toEqual(["*", "*a"])
  })

  test("a fully anchored empty alternative keeps the arm that names a path", () => {
    expect(regexToGlobs("^(|a)$")).toEqual(["a"])
    expect(regexToGlobs("^(a|)$")).toEqual(["a"])
    expect(regexToGlobs("^(|a|)$")).toEqual(["a"])
  })

  test("a fully anchored pattern with one empty alternative allows the other one", () => {
    expect(regexToGlobs("^(package\\.json|)$")).toEqual(["package.json"])
  })

  test("a fully anchored pattern of only empty alternatives is rejected", () => {
    expect(regexToGlobs("^(|)$")).toBeNull()
    expect(regexToGlobs("^(||)$")).toBeNull()
    expect(regexToGlobs("^()$")).toBeNull()
  })

  test("a single start anchor keeps an empty alternative as the catch-all arm", () => {
    expect(regexToGlobs("^(|)")).toEqual(["*"])
    expect(regexToGlobs("^(|a|)")).toEqual(["*", "a*"])
  })

  test("a group of only empty alternatives becomes the catch-all arm", () => {
    expect(regexToGlobs("(|)")).toEqual(["*"])
  })

  test("a home-relative arm is rejected because the CLI expands it", () => {
    expect(regexToGlobs("^~/\\.ssh/")).toBeNull()
    expect(regexToGlobs("^~/\\.ssh/id_rsa$")).toBeNull()
    expect(regexToGlobs("^~$")).toBeNull()
  })

  test("a $HOME arm is rejected because the CLI expands it", () => {
    expect(regexToGlobs("^\\$HOME/\\.ssh/")).toBeNull()
  })

  test("a tilde that is not at the start of the arm still translates", () => {
    // `*~*` and `*~/.ssh*` keep the leading `*`, so the CLI leaves them alone.
    expect(regexToGlobs("~")).toEqual(["*~*"])
    expect(regexToGlobs("~/\\.ssh")).toEqual(["*~/.ssh*"])
    expect(regexToGlobs("^src/~backup/")).toEqual(["src/~backup/*"])
  })

  test("a plain suffix anchor is not caught by the home guard", () => {
    expect(regexToGlobs(".*\\.md$")).toEqual(["*.md"])
  })

  test("an escaped non-ASCII character is rejected", () => {
    expect(regexToGlobs("a\\\u00a0b")).toBeNull()
    expect(regexToGlobs("a\\\u2007b")).toBeNull()
    expect(regexToGlobs("a\\\u202fb")).toBeNull()
    expect(regexToGlobs("a\\\u2167b")).toBeNull()
    expect(regexToGlobs("a\\\u20acb")).toBeNull()
  })

  test("an escaped ASCII punctuation character still translates", () => {
    expect(regexToGlobs("a\\-b")).toEqual(["*a-b*"])
    expect(regexToGlobs("a\\@b")).toEqual(["*a@b*"])
  })
})
