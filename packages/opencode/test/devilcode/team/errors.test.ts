import { describe, it, expect } from "bun:test"
import {
  TeamImportError,
  TeamVersionMismatchError,
  TeamChecksumError,
  TeamSchemaValidationError,
} from "@/devilcode/team/errors"
import type { ZodIssue } from "zod"
import { z } from "zod"

describe("TeamImportError", () => {
  it("name is TeamImportError and kind/filePath propagate", () => {
    const err = new TeamImportError({ kind: "json-parse-failed", filePath: "/tmp/x.json" })
    expect(err.name).toBe("TeamImportError")
    expect(err.kind).toBe("json-parse-failed")
    expect(err.filePath).toBe("/tmp/x.json")
    expect(err.message).toContain("json-parse-failed")
  })

  it("accepts optional cause", () => {
    const root = new Error("inner")
    const err = new TeamImportError({ kind: "file-not-found", cause: root })
    expect((err as Error & { cause?: unknown }).cause).toBe(root)
  })
})

describe("TeamVersionMismatchError", () => {
  it("sets found/required and kind=version-mismatch", () => {
    const err = new TeamVersionMismatchError({ found: "9.9.9", required: "1.0.0", filePath: "/t/x.json" })
    expect(err.name).toBe("TeamVersionMismatchError")
    expect(err.found).toBe("9.9.9")
    expect(err.required).toBe("1.0.0")
    expect(err.kind).toBe("version-mismatch")
    expect(err.filePath).toBe("/t/x.json")
    expect(err instanceof TeamImportError).toBe(true)
  })
})

describe("TeamChecksumError", () => {
  it("sets kind=checksum-failed and is a TeamImportError", () => {
    const err = new TeamChecksumError({ filePath: "/t/y.json" })
    expect(err.name).toBe("TeamChecksumError")
    expect(err.kind).toBe("checksum-failed")
    expect(err.filePath).toBe("/t/y.json")
    expect(err instanceof TeamImportError).toBe(true)
  })

  it("works without filePath", () => {
    const err = new TeamChecksumError()
    expect(err.kind).toBe("checksum-failed")
  })
})

describe("TeamSchemaValidationError", () => {
  const sampleIssues: ZodIssue[] = [
    { code: z.ZodIssueCode.custom, path: ["roles"], message: "missing" },
    { code: z.ZodIssueCode.custom, path: ["routing", "defaultRole"], message: "bad" },
  ]

  it("envelope layer → kind=envelope-invalid", () => {
    const err = new TeamSchemaValidationError({ layer: "envelope", issues: sampleIssues })
    expect(err.name).toBe("TeamSchemaValidationError")
    expect(err.kind).toBe("envelope-invalid")
    expect(err.layer).toBe("envelope")
    expect(err.issues).toEqual(sampleIssues)
    expect(err instanceof TeamImportError).toBe(true)
  })

  it("config layer → kind=config-invalid", () => {
    const err = new TeamSchemaValidationError({ layer: "config", issues: sampleIssues })
    expect(err.kind).toBe("config-invalid")
    expect(err.layer).toBe("config")
  })

  it("message formats each issue path", () => {
    const err = new TeamSchemaValidationError({ layer: "config", issues: sampleIssues })
    expect(err.message).toContain("roles: missing")
    expect(err.message).toContain("routing.defaultRole: bad")
  })
})
