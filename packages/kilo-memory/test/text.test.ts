import { describe, expect, test } from "bun:test"
import { MemoryText } from "../src/text"

describe("memory text helpers", () => {
  test("brief collapses internal whitespace and trims edges", () => {
    expect(MemoryText.brief("  a\t b\n c  ", 80)).toBe("a b c")
  })

  test("brief returns input unchanged when within the limit", () => {
    expect(MemoryText.brief("short", 80)).toBe("short")
  })

  test("brief clips overflow and appends an ellipsis", () => {
    expect(MemoryText.brief("abcdefghij", 8)).toBe("abcde...")
  })

  test("brief degrades safely at tiny limits", () => {
    expect(MemoryText.brief("abcdef", 2)).toBe("...")
  })
})
