import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "./index"

describe("Pierre diff options", () => {
  test("keeps changed identifiers intact in unified and split diffs", () => {
    expect(createDefaultOptions("unified").lineDiffType).toBe("word-alt")
    expect(createDefaultOptions("split").lineDiffType).toBe("word-alt")
  })

  test("applies inherited opt-in backgrounds inside Pierre's shadow root", () => {
    const css = createDefaultOptions("unified").unsafeCSS

    expect(css).toContain("--kilo-diff-line-add-background")
    expect(css).toContain("--kilo-diff-line-delete-background")
  })
})
