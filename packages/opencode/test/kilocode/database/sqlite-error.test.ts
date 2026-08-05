import { describe, expect, test } from "bun:test"
import { LockTimeoutError, SqlError, UnknownError } from "effect/unstable/sql/SqlError"
import { busyMessage, isBusy } from "@/kilocode/database/sqlite-error"

describe("SQLite errors", () => {
  test("recognizes lock timeouts as busy database errors", () => {
    const error = new SqlError({
      reason: new LockTimeoutError({
        cause: new Error("database is locked"),
        message: "Failed to execute statement",
        operation: "execute",
      }),
    })

    expect(isBusy(error)).toBe(true)
    expect(busyMessage).toBe("Database is busy. Please try again in a moment.")
  })

  test("does not classify other SQLite errors as busy", () => {
    const error = new SqlError({
      reason: new UnknownError({
        cause: new Error("constraint failed"),
        message: "Failed to execute statement",
        operation: "execute",
      }),
    })

    expect(isBusy(error)).toBe(false)
  })
})
