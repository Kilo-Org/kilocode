import { describe, expect, test } from "bun:test"
import { MemoryAutosaveStatus } from "../src/autosave-status"
import { MemoryDecisions } from "../src/decisions"
import { MemoryMarkerMeta } from "../src/marker-meta"

describe("memory decisions", () => {
  test("summarizes no decisions", () => {
    expect(MemoryDecisions.summarize("")).toEqual({
      lastSave: undefined,
      latestOperations: [],
      latestSkipped: undefined,
      accepted: 0,
      skipped: 0,
      fallback: false,
      files: [],
      lastRecall: undefined,
      errors: [],
    })
  })

  test("summarizes typed saves", () => {
    const text = [
      JSON.stringify({
        kind: "typed",
        result: "saved",
        operationCount: 2,
        skippedCount: 1,
        files: ["project.md", "project.md", "environment.md"],
        operations: [
          { action: "add", file: "project.md", key: "deploy_target" },
          { action: "remove", query: "old deploy target" },
        ],
        skipped: [{ reason: "duplicate", duplicateOf: "project.md:deploy_target" }],
      }),
    ].join("\n")

    expect(MemoryDecisions.summarize(text)).toMatchObject({
      lastSave: { result: "saved" },
      latestOperations: [
        { type: "memory", file: "project.md", key: "deploy_target" },
        { type: "remove", query: "old deploy target" },
      ],
      latestSkipped: { reason: "duplicate", duplicateOf: "project.md:deploy_target" },
      accepted: 2,
      skipped: 1,
      fallback: false,
      files: ["project.md", "environment.md"],
    })
  })

  test("detects fallback saves", () => {
    const text = [
      JSON.stringify({ kind: "typed", result: "fallback", operationCount: 0, skippedCount: 1 }),
      JSON.stringify({ kind: "typed", result: "saved", fallback: true, reason: "provider_error" }),
    ].join("\n")

    expect(MemoryDecisions.summarize(text)).toMatchObject({
      lastSave: { result: "saved", reason: "provider_error" },
      accepted: 0,
      skipped: 1,
      fallback: true,
    })
  })

  test("summarizes recall records", () => {
    const text = JSON.stringify({
      kind: "recall",
      query: "deploy",
      topics: ["deploy", "deploy", "env"],
      files: ["project.md"],
    })

    expect(MemoryDecisions.summarize(text).lastRecall).toEqual({
      query: "deploy",
      topics: ["deploy", "env"],
      files: ["project.md"],
    })
  })

  test("skips malformed lines", () => {
    const text = [
      "{",
      JSON.stringify({ kind: "typed", result: "error" }),
      "[]",
      JSON.stringify({ kind: "log", reason: "parse_error" }),
    ].join("\n")

    expect(MemoryDecisions.summarize(text)).toMatchObject({
      lastSave: { result: "error" },
      errors: ["error", "parse_error"],
    })
  })
})

describe("memory autosave status", () => {
  test("returns off", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: false,
        stats: { lastTypedConsolidationAt: 1000, lastSessionSavedAt: 1200, lastOperationCount: 2 },
      }),
    ).toEqual({ state: "off", count: 0, at: undefined })
  })

  test("returns watching", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: true,
        stats: { lastTypedConsolidationAt: null, lastSessionSavedAt: null, lastOperationCount: 0 },
      }),
    ).toEqual({ state: "watching", count: 0, at: undefined })
  })

  test("returns handoff for digest-only save", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: true,
        stats: { lastTypedConsolidationAt: null, lastSessionSavedAt: 1200, lastOperationCount: 0 },
      }),
    ).toEqual({ state: "handoff", count: 0, at: 1200 })
  })

  test("returns saved", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: true,
        stats: { lastTypedConsolidationAt: 1000, lastSessionSavedAt: 1200, lastOperationCount: 2 },
      }),
    ).toEqual({ state: "saved", count: 2, at: 1000 })
  })

  test("returns handoff when typed saved no facts and digest is latest", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: true,
        stats: { lastTypedConsolidationAt: 1000, lastSessionSavedAt: 1200, lastOperationCount: 0 },
      }),
    ).toEqual({ state: "handoff", count: 0, at: 1200 })
  })

  test("returns idle", () => {
    expect(
      MemoryAutosaveStatus.summarize({
        autoConsolidate: true,
        stats: { lastTypedConsolidationAt: 1000, lastSessionSavedAt: null, lastOperationCount: 0 },
      }),
    ).toEqual({ state: "idle", count: 0, at: 1000 })
  })
})

describe("memory marker metadata", () => {
  test("decodes encoded marker metadata", () => {
    const marker: MemoryMarkerMeta.Info = {
      type: "recall",
      bytes: 10,
      tokens: 4,
      count: 2,
      files: ["project.md", "environment.md"],
      items: ["first memory", "second memory"],
    }

    expect(MemoryMarkerMeta.fromParts([{ type: "text", metadata: MemoryMarkerMeta.metadata(marker, true) }])).toEqual({
      type: "recall",
      tokens: 4,
      count: 2,
      files: ["project.md", "environment.md"],
      items: ["first memory", "second memory"],
    })
  })

  test("decodes legacy metadata that only carries sources", () => {
    expect(
      MemoryMarkerMeta.fromParts([
        { type: "text", metadata: { kiloMemory: { type: "startup", tokens: 3, sources: ["project.md"] } } },
      ]),
    ).toEqual({
      type: "startup",
      tokens: 3,
      count: 1,
      files: ["project.md"],
      items: [],
    })
  })

  test("builds recall metadata from sources", () => {
    expect(
      MemoryMarkerMeta.fromRecall({
        output: "record id=remembered source=project.md\ntext: remembered",
        metadata: { sources: ["project.md", "project.md"], count: 1 },
        tokens: 3,
      }),
    ).toEqual({
      type: "recall",
      bytes: Buffer.byteLength("record id=remembered source=project.md\ntext: remembered"),
      tokens: 3,
      count: 1,
      files: ["project.md"],
      items: ["remembered"],
    })
  })

  test("does not retain startup context snippets", () => {
    const text = Array.from(
      { length: 6 },
      (_, index) => `record id=${index} source=project.md\ntext: ${"x".repeat(121)}`,
    ).join("\n")
    expect(MemoryMarkerMeta.fromBlocks([{ text, bytes: Buffer.byteLength(text), estimatedTokens: 8 }])).toMatchObject({
      type: "startup",
      count: 6,
      files: ["project.md"],
      items: [],
    })
  })

  test("persists recall snippets only in verbose mode", () => {
    const marker: MemoryMarkerMeta.Info = {
      type: "recall",
      bytes: 10,
      tokens: 4,
      count: 1,
      files: ["project.md"],
      items: ["private memory"],
    }

    expect(MemoryMarkerMeta.metadata(marker).kiloMemory).not.toHaveProperty("items")
    expect(MemoryMarkerMeta.metadata(marker, true).kiloMemory).toHaveProperty("items", ["private memory"])
  })

  test("bounds recall snippets without splitting surrogate pairs", () => {
    const text = Array.from(
      { length: 6 },
      (_, index) => `record id=${index} source=project.md\ntext: ${"x".repeat(119)}😀z`,
    ).join("\n")
    const marker = MemoryMarkerMeta.fromRecall({
      output: text,
      metadata: { sources: ["project.md"], count: 6 },
      tokens: 8,
    })

    expect(marker?.items).toEqual(Array.from({ length: 5 }, () => `${"x".repeat(119)}😀`))
  })

  test("shows recall snippets only when verbose", () => {
    const recall: MemoryMarkerMeta.Decoded = {
      type: "recall",
      tokens: 4,
      count: 1,
      files: ["project.md"],
      items: ["remembered"],
    }
    const startup = { ...recall, type: "startup" as const }

    expect(MemoryMarkerMeta.snippets(recall, false)).toEqual([])
    expect(MemoryMarkerMeta.snippets(startup, true)).toEqual([])
    expect(MemoryMarkerMeta.snippets(recall, true)).toEqual(["remembered"])
  })
})
