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

  test("highlights filename with a space via fallback regex detection", () => {
    expect(buildHighlightedTextSegments("check @org data.xlsx now", [], [])).toEqual([
      { text: "check " },
      { text: "@org data.xlsx", type: "file" },
      { text: " now" },
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
