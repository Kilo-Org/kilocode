import { describe, expect, test } from "bun:test"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { empty, reason, scope } from "@/kilocode/tool/semantic-search-output"

function status(over: Partial<IndexingStatus>): IndexingStatus {
  return { state: "Complete", message: "", processedFiles: 0, totalFiles: 0, percent: 0, ...over }
}

describe("scope", () => {
  test("names the root when the whole index was searched", () => {
    expect(scope("/repo")).toBe("/repo")
  })

  test("names the subdirectory when the search was narrowed", () => {
    expect(scope("/repo", "src/app")).toBe("/repo/src/app")
  })

  test("reports a Windows prefix with forward slashes", () => {
    expect(scope("C:/repo", "src\\app")).toBe("C:/repo/src/app")
  })
})

describe("reason", () => {
  test("distinguishes a complete index from an unavailable one", () => {
    expect(reason(status({ state: "Complete" }))).toContain("up to date")
    expect(reason(undefined)).toContain("not evidence")
  })

  test("reports progress while the index is still building", () => {
    const text = reason(status({ state: "In Progress", percent: 40, processedFiles: 120, totalFiles: 300 }))
    expect(text).toContain("still building (40%, 120/300 files)")
    expect(text).toContain("incomplete")
  })

  test("says nothing was searched when indexing is disabled", () => {
    const text = reason(status({ state: "Disabled", message: "Enable it in Kilo Settings." }))
    expect(text).toContain("disabled for this project")
    expect(text).toContain("nothing was searched")
    expect(text).toContain("Enable it in Kilo Settings.")
  })

  test("says nothing was searched when indexing failed", () => {
    expect(reason(status({ state: "Error", message: "Failed to initialize: bad model" }))).toContain(
      "Codebase indexing failed, so nothing was searched. Failed to initialize: bad model",
    )
  })

  test("omits an empty status message rather than leaving trailing space", () => {
    expect(reason(status({ state: "Disabled", message: "  " }))).toBe(
      "Codebase indexing is disabled for this project, so nothing was searched.",
    )
  })
})

describe("empty", () => {
  test("states the query, the searched scope, the index state, and the multi-root caveat", () => {
    const text = empty("auth flow", "/repo", undefined, status({ state: "Complete" }))
    expect(text.split("\n")).toEqual([
      'No results for "auth flow" in /repo.',
      "The index is up to date, so no semantically similar code exists in this scope.",
      "Only /repo is indexed. Files in other workspace folders are not searchable here — use Read with an absolute path.",
    ])
  })

  test("does not claim the code is absent when the index never ran", () => {
    const text = empty("auth flow", "/repo", undefined, status({ state: "Disabled" }))
    expect(text).not.toContain("no semantically similar code exists")
    expect(text).toContain("nothing was searched")
  })
})
