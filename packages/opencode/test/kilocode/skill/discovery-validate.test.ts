import { describe, expect, test } from "bun:test"
import { isSafeSegment, isSafeRelativePath } from "@/kilocode/skill/discovery-validate"

describe("isSafeSegment", () => {
  test("accepts a plain skill name", () => {
    expect(isSafeSegment("git-status")).toBe(true)
  })

  test("rejects traversal, separators, empties, and null bytes", () => {
    for (const value of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
      expect(isSafeSegment(value)).toBe(false)
    }
  })
})

describe("isSafeRelativePath", () => {
  test("accepts nested relative paths", () => {
    expect(isSafeRelativePath("SKILL.md")).toBe(true)
    expect(isSafeRelativePath("scripts/setup.sh")).toBe(true)
  })

  test("rejects traversal segments", () => {
    expect(isSafeRelativePath("../evil")).toBe(false)
    expect(isSafeRelativePath("a/../../b")).toBe(false)
  })

  test("rejects absolute paths on either platform", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false)
    expect(isSafeRelativePath("C:\\Windows")).toBe(false)
  })

  test("rejects URLs, query/fragment, backslashes, and null bytes", () => {
    for (const value of ["http://evil.test/x", "a?b", "a#b", "a\\b", "a\0b"]) {
      expect(isSafeRelativePath(value)).toBe(false)
    }
  })

  test("rejects percent-encoded traversal", () => {
    expect(isSafeRelativePath("%2e%2e/evil")).toBe(false)
    expect(isSafeRelativePath("%2f")).toBe(false)
  })
})
