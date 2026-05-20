/**
 * Contract tests for Kilo-specific fields on QuestionOption / QuestionInfo.
 *
 * packages/opencode/src/question/index.ts is a shared upstream file.
 * Two Kilo additions to the Option schema have been silently dropped by
 * upstream merges more than once:
 *
 *   1. labelKey / descriptionKey  — lost during the opencode v1.3.x
 *      effectify refactor (cec1255b36), restored in PR #9246.
 *   2. mode  — lost in the same merge cycle (c37f85386f + 5bb42b6bdb),
 *      restored in the ionized-emmental branch.
 *
 * The plan follow-up "Continue here" option relies on `mode: "code"` being
 * present at the schema level so Effect Schema's decodeUnknownSync does not
 * strip the field before the question is published via SSE, and so the
 * generated SDK / OpenAPI spec expose the field to VS Code.
 *
 * These tests catch regressions at the source level, before a runtime test
 * could even run.
 */

import { describe, test, expect } from "bun:test"
import { Schema } from "effect"
import fs from "node:fs"
import path from "node:path"
import { Option } from "../../src/question"

const SOURCE = path.resolve(import.meta.dir, "../../src/question/index.ts")

describe("QuestionOption schema — Kilo-specific field contract", () => {
  test("Option class accepts and round-trips the mode field", () => {
    const raw = { label: "Continue here", description: "Implement the plan in this session", mode: "code" }
    const decoded = Schema.decodeUnknownSync(Option)(raw)
    expect(decoded.mode).toBe("code")
  })

  test("mode is optional — Option without it decodes cleanly", () => {
    const raw = { label: "Start new session", description: "Fresh session" }
    const decoded = Schema.decodeUnknownSync(Option)(raw)
    expect(decoded.mode).toBeUndefined()
  })

  test("Option class accepts and round-trips labelKey and descriptionKey", () => {
    const raw = {
      label: "Continue here",
      description: "Implement the plan in this session",
      labelKey: "plan.followup.answer.continue",
      descriptionKey: "plan.followup.answer.continue.description",
    }
    const decoded = Schema.decodeUnknownSync(Option)(raw)
    expect(decoded.labelKey).toBe("plan.followup.answer.continue")
    expect(decoded.descriptionKey).toBe("plan.followup.answer.continue.description")
  })

  // Static source checks — guard the kilocode_change markers so a conflict
  // resolution that drops the fields is caught immediately.
  test("source declares mode as an optional field inside a kilocode_change block", () => {
    const src = fs.readFileSync(SOURCE, "utf-8")
    expect(src).toMatch(/kilocode_change start[^\n]*hint to UI clients/)
    expect(src).toMatch(/mode:\s*Schema\.optional\(Schema\.String\)/)
    expect(src).toMatch(/kilocode_change end/)
  })

  test("source declares labelKey and descriptionKey inside a kilocode_change block", () => {
    const src = fs.readFileSync(SOURCE, "utf-8")
    expect(src).toMatch(/kilocode_change start[^\n]*i18n keys/)
    expect(src).toMatch(/labelKey:\s*Schema\.optional\(Schema\.String\)/)
    expect(src).toMatch(/descriptionKey:\s*Schema\.optional\(Schema\.String\)/)
  })
})
