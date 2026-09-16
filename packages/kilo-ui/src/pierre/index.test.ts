import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "./index"

describe("Pierre diff options", () => {
  test("keeps changed identifiers intact in unified and split diffs", () => {
    expect(createDefaultOptions("unified")).toMatchObject({
      diffIndicators: "bars",
      lineDiffType: "word-alt",
    })
    expect(createDefaultOptions("split")).toMatchObject({
      diffIndicators: "bars",
      lineDiffType: "word-alt",
    })
  })
})
