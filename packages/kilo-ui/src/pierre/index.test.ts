import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "./index"

describe("Pierre diff options", () => {
  test("keeps changed identifiers intact in unified and split diffs", () => {
    expect(createDefaultOptions("unified").lineDiffType).toBe("word-alt")
    expect(createDefaultOptions("split").lineDiffType).toBe("word-alt")
  })
})
