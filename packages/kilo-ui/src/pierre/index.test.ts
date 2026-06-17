import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "./index"

describe("Pierre diff options", () => {
  test("highlights changed characters in unified and split diffs", () => {
    expect(createDefaultOptions("unified").lineDiffType).toBe("char")
    expect(createDefaultOptions("split").lineDiffType).toBe("char")
  })
})
