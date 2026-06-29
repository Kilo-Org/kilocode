import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "./index"

describe("Pierre diff options", () => {
  test("keeps changed identifiers intact in unified and split diffs", () => {
    expect(createDefaultOptions("unified").lineDiffType).toBe("word-alt")
    expect(createDefaultOptions("split").lineDiffType).toBe("word-alt")
  })

  test("applies final semantic diff surfaces and host color scheme", () => {
    const opts = createDefaultOptions("unified")

    expect(opts.unsafeCSS).toContain(":host([data-color-scheme='light'])")
    expect(opts.unsafeCSS).toContain(":host([data-color-scheme='dark'])")
    expect(opts.unsafeCSS).toContain("--surface-diff-add-base")
    expect(opts.unsafeCSS).toContain("--surface-diff-add-weaker")
    expect(opts.unsafeCSS).toContain("--surface-diff-delete-base")
    expect(opts.unsafeCSS).toContain("--surface-diff-delete-weaker")
    expect(opts.unsafeCSS).toContain("outline: 1px solid var(--border-contrast, transparent)")
  })
})
