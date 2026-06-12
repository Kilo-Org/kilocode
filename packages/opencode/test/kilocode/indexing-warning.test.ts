import { describe, expect, test } from "bun:test"
import { indexingErrorMessage, indexingWarningKey, parseQdrantWarning } from "../../src/kilocode/indexing-warning"

describe("parseQdrantWarning", () => {
  test("classifies incompatible Qdrant versions", () => {
    const message =
      "Client version 1.17.0 is incompatible with server version 1.14.1. Major versions should match and minor version difference must not exceed 1. Set checkCompatibility=false to skip version check."

    expect(parseQdrantWarning(message)).toEqual({
      code: "qdrant.version-incompatible",
      message:
        "Client version 1.17.0 is incompatible with server version 1.14.1. Set checkCompatibility=false to skip version check.",
    })
  })

  test("classifies unavailable Qdrant versions", () => {
    const message =
      "Failed to obtain server version. Unable to check client-server compatibility. Set checkCompatibility=false to skip version check."

    expect(parseQdrantWarning(message)).toEqual({
      code: "qdrant.version-unavailable",
      message,
    })
  })

  test("ignores unrelated warnings and non-string values", () => {
    expect(parseQdrantWarning("Api key is used with unsecure connection.")).toBeUndefined()
    expect(parseQdrantWarning(new Error("warning"))).toBeUndefined()
  })
})

test("classifies error statuses for TUI notifications", () => {
  const status = { processedFiles: 0, totalFiles: 0, percent: 0 }

  expect(indexingErrorMessage({ ...status, state: "Error", message: "Unable to connect" })).toBe("Unable to connect")
  expect(indexingErrorMessage({ ...status, state: "Complete", message: "Index up-to-date." })).toBeUndefined()
})

test("indexingWarningKey includes the warning code and message", () => {
  expect(indexingWarningKey({ code: "qdrant.version-unavailable", message: "warning" })).toBe(
    "qdrant.version-unavailable\u0000warning",
  )
})
