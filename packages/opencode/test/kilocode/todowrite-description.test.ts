import { describe, expect, test } from "bun:test"
import DESCRIPTION_WRITE from "../../src/tool/todowrite.txt"

describe("todowrite description", () => {
  test("requires an update between each task", () => {
    expect(DESCRIPTION_WRITE).toContain("call this tool before starting the first item")
    expect(DESCRIPTION_WRITE).toContain("After completing each item, call this tool before starting the next item")
    expect(DESCRIPTION_WRITE).toContain("Do not complete multiple items or continue through multiple steps")
  })
})
