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

  test("highlights filename with a space when source offsets are provided", () => {
    const text = "check @org data.xlsx now"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "org data.xlsx",
            text: { value: "@org data.xlsx", start: 6, end: 20 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([
      { text: "check " },
      { text: "@org data.xlsx", type: "file" },
      { text: " now" },
    ])
  })

  test("fallback regex does not match filenames containing spaces (requires source offsets)", () => {
    // The fallback regex intentionally excludes spaces: a pattern permissive enough to
    // span space-separated path segments would also swallow ordinary prose following
    // any unrelated @mention. Highlighting space-containing paths relies on source.text.
    const text = "check @org data.xlsx now"
    expect(buildHighlightedTextSegments(text, [], [])).toEqual([{ text }])
  })

  test("fallback regex does not over-match ordinary prose following an unrelated @mention", () => {
    const text = "@code-reviewer check the report for v1.2 details"
    expect(buildHighlightedTextSegments(text, [], [])).toEqual([{ text }])
  })

  test("fallback regex still detects a plain mention without swallowing trailing prose", () => {
    const text = "see @src/index.ts for v1.2 details"
    expect(buildHighlightedTextSegments(text, [], [])).toEqual([
      { text: "see " },
      { text: "@src/index.ts", type: "file" },
      { text: " for v1.2 details" },
    ])
  })

  test("highlights every repeated occurrence of a plain mention when only one ref exists", () => {
    // mentionedPaths is a Set, so buildFileAttachments only ever produces one
    // ref per unique path even when it's mentioned twice in the same message.
    const text = "compare @src/a.ts with @src/a.ts"
    const segments = buildHighlightedTextSegments(
      text,
      [{ source: { type: "file", path: "src/a.ts", text: { value: "@src/a.ts", start: 8, end: 17 } } }],
      [],
    )

    expect(segments).toEqual([
      { text: "compare " },
      { text: "@src/a.ts", type: "file" },
      { text: " with " },
      { text: "@src/a.ts", type: "file" },
    ])
  })

  test("does not let a shorter mention's repeat-search truncate a longer mention that starts the same way", () => {
    // "@a.ts" is a literal prefix of "@a.tsx". A naive repeat-search for the
    // first ref's value would match inside the second, distinct mention and
    // drop its highlight (or worse, wrongly highlight only part of it).
    const text = "see @a.ts and also @a.tsx"
    const segments = buildHighlightedTextSegments(
      text,
      [
        { source: { type: "file", path: "a.ts", text: { value: "@a.ts", start: 4, end: 9 } } },
        { source: { type: "file", path: "a.tsx", text: { value: "@a.tsx", start: 19, end: 25 } } },
      ],
      [],
    )

    expect(segments).toEqual([
      { text: "see " },
      { text: "@a.ts", type: "file" },
      { text: " and also " },
      { text: "@a.tsx", type: "file" },
    ])
  })

  test("highlights every repeated occurrence of a mention containing a space when only one ref exists", () => {
    const text = "a @dup name.ts b @dup name.ts c"
    const segments = buildHighlightedTextSegments(
      text,
      [{ source: { type: "file", path: "dup name.ts", text: { value: "@dup name.ts", start: 2, end: 14 } } }],
      [],
    )

    expect(segments).toEqual([
      { text: "a " },
      { text: "@dup name.ts", type: "file" },
      { text: " b " },
      { text: "@dup name.ts", type: "file" },
      { text: " c" },
    ])
  })

  test("highlights Cyrillic filename when source offsets are provided", () => {
    const text = "open @файл.txt please"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "файл.txt",
            text: { value: "@файл.txt", start: 5, end: 14 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([{ text: "open " }, { text: "@файл.txt", type: "file" }, { text: " please" }])
  })

  test("highlights Chinese filename when source offsets are provided", () => {
    const text = "read @文件.txt"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "文件.txt",
            text: { value: "@文件.txt", start: 5, end: 11 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([{ text: "read " }, { text: "@文件.txt", type: "file" }])
  })

  test("highlights filename with space in directory and source offsets", () => {
    const text = "using @my folder/report.xlsx here"
    const segments = buildHighlightedTextSegments(
      text,
      [
        {
          source: {
            type: "file",
            path: "my folder/report.xlsx",
            text: { value: "@my folder/report.xlsx", start: 6, end: 28 },
          },
        },
      ],
      [],
    )

    expect(segments).toEqual([
      { text: "using " },
      { text: "@my folder/report.xlsx", type: "file" },
      { text: " here" },
    ])
  })
})
