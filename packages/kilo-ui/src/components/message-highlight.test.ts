import { describe, expect, test } from "bun:test"
import { buildHighlightedTextSegments } from "./message-highlight"

describe("message highlight", () => {
  test("relocates stale file source offsets by source value", () => {
    const text = "merge main into the current worktree branch\n\n@git-changes"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "git-changes.txt",
            text: { value: "@git-changes", start: 12, end: 24 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([
      { text: "merge main into the current worktree branch\n\n" },
      { text: "@git-changes", type: "file" },
    ])
  })

  test("relocates repeated stale source values in order", () => {
    const text = "expanded @git-changes then @git-changes"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "git-changes.txt",
            text: { value: "@git-changes", start: 3, end: 15 },
          },
        },
        {
          source: {
            type: "file",
            path: "git-changes.txt",
            text: { value: "@git-changes", start: 16, end: 28 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([
      { text: "expanded " },
      { text: "@git-changes", type: "file" },
      { text: " then " },
      { text: "@git-changes", type: "file" },
    ])
  })

  test("keeps valid source offsets", () => {
    const text = "use @src/index.ts"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "src/index.ts",
            text: { value: "@src/index.ts", start: 4, end: 17 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([{ text: "use " }, { text: "@src/index.ts", type: "file" }])
  })

  test("falls back to path mention detection when no source offsets exist", () => {
    expect(buildHighlightedTextSegments("inspect @src/index.ts", [], [])).toEqual([
      { text: "inspect " },
      { text: "@src/index.ts", type: "file" },
    ])
  })
})
