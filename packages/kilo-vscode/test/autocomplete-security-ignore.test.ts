import { describe, expect, it } from "bun:test"
import { isSecurityConcern } from "../src/services/autocomplete/continuedev/core/indexing/ignore"

describe("isSecurityConcern", () => {
  it("flags a sensitive directory nested below the immediate parent", () => {
    expect(isSecurityConcern("/repo/secrets/prod/notes.md")).toBe(true)
    expect(isSecurityConcern("/repo/app/.ssh/nested/id_rsa")).toBe(true)
  })

  it("flags sensitive file types and the immediate parent", () => {
    expect(isSecurityConcern("/repo/.env")).toBe(true)
    expect(isSecurityConcern("/repo/secrets/notes.md")).toBe(true)
  })

  it("allows ordinary source files", () => {
    expect(isSecurityConcern("/repo/src/app.ts")).toBe(false)
    expect(isSecurityConcern("src/app.ts")).toBe(false)
    expect(isSecurityConcern("")).toBe(false)
  })
})
