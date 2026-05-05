// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { filterDiagnostics } from "@/tool/diagnostics"
import type { LSPClient } from "@/lsp/client"

describe("filterDiagnostics", () => {
  const makeDiagnostic = (severity: number, message: string) =>
    ({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      severity,
      message,
      source: "ts",
    }) as LSPClient.Diagnostic

  const allDiagnostics = {
    "/project/src/edited.ts": [makeDiagnostic(1, "Error in edited file"), makeDiagnostic(2, "Warning in edited file")],
    "/project/src/other.ts": [
      makeDiagnostic(1, "Error in other file"),
      makeDiagnostic(1, "Another error in other file"),
    ],
    "/project/src/third.ts": [makeDiagnostic(2, "Warning in third file")],
  }

  test("keeps only diagnostics for specified files", () => {
    const result = filterDiagnostics(allDiagnostics, ["/project/src/edited.ts"])
    expect(Object.keys(result)).toEqual(["/project/src/edited.ts"])
    expect(result["/project/src/edited.ts"]).toHaveLength(2)
  })

  test("keeps diagnostics for multiple specified files", () => {
    const result = filterDiagnostics(allDiagnostics, ["/project/src/edited.ts", "/project/src/third.ts"])
    expect(Object.keys(result).sort()).toEqual(["/project/src/edited.ts", "/project/src/third.ts"])
    expect(result["/project/src/edited.ts"]).toHaveLength(2)
    expect(result["/project/src/third.ts"]).toHaveLength(1)
  })

  test("returns empty object when no files match", () => {
    const result = filterDiagnostics(allDiagnostics, ["/project/src/nonexistent.ts"])
    expect(result).toEqual({})
  })

  test("returns empty object when diagnostics is empty", () => {
    const result = filterDiagnostics({}, ["/project/src/edited.ts"])
    expect(result).toEqual({})
  })

  test("returns empty object when file list is empty", () => {
    const result = filterDiagnostics(allDiagnostics, [])
    expect(result).toEqual({})
  })

  test("preserves all diagnostic properties for matching files", () => {
    const result = filterDiagnostics(allDiagnostics, ["/project/src/edited.ts"])
    expect(result["/project/src/edited.ts"]).toEqual(allDiagnostics["/project/src/edited.ts"])
  })
})
