import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildRecord, isRedacted, record } from "../../src/kilocode/gate/action-telemetry"

describe("ActionTelemetry — redacted classifier telemetry", () => {
  const rec = buildRecord({
    sessionID: "ses_abc",
    callID: "call_1",
    decision: "block",
    reasonCode: "data_exposure",
    providerID: "openrouter",
    modelID: "thinkingmachines/inkling-small",
    durationMs: 1234.7,
    usage: { inputTokens: 210, outputTokens: 12 },
  })

  test("carries only latency/cost/verdict fields — never intent, command, or args", () => {
    expect(isRedacted(rec as unknown as Record<string, unknown>)).toBe(true)
    expect(Object.keys(rec).sort()).toEqual(
      ["callID", "decision", "durationMs", "inputTokens", "model", "outputTokens", "reasonCode", "sessionID", "ts"].sort(),
    )
    for (const forbidden of ["intent", "userIntent", "command", "commands", "args", "payload"]) {
      expect(forbidden in rec).toBe(false)
    }
  })
  test("values are shaped as expected (model joined, duration rounded, callID kept)", () => {
    expect(rec.model).toBe("openrouter/thinkingmachines/inkling-small")
    expect(rec.durationMs).toBe(1235)
    expect(rec.callID).toBe("call_1")
    expect(rec.inputTokens).toBe(210)
    expect(rec.outputTokens).toBe(12)
  })
  test("tokens are null when the model call did not complete", () => {
    const r = buildRecord({
      sessionID: "s",
      decision: "block",
      reasonCode: "classifier_timeout",
      providerID: "openrouter",
      modelID: "x",
      durationMs: 15000,
    })
    expect(r.inputTokens).toBeNull()
    expect(r.outputTokens).toBeNull()
    expect(r.callID).toBe("")
  })
  test("isRedacted rejects an object carrying a forbidden field", () => {
    expect(isRedacted({ ...rec, command: "rm -rf /" } as Record<string, unknown>)).toBe(false)
  })
  test("record() is a no-op (never throws) when telemetry is disabled", () => {
    delete process.env["KILO_CLASSIFIER_TELEMETRY"]
    expect(() => record(rec)).not.toThrow()
  })
})

describe("ActionTelemetry.record — writes JSONL when enabled", () => {
  let file: string | undefined
  afterEach(() => {
    delete process.env["KILO_CLASSIFIER_TELEMETRY"]
    if (file && fs.existsSync(file)) fs.unlinkSync(file)
  })
  test("appends one redacted line per record", () => {
    file = path.join(os.tmpdir(), `clf-tel-${Date.now()}.jsonl`)
    process.env["KILO_CLASSIFIER_TELEMETRY"] = file
    record(buildRecord({ sessionID: "s1", callID: "c1", decision: "allow", reasonCode: "matches_intent", providerID: "p", modelID: "m", durationMs: 900, usage: { inputTokens: 5, outputTokens: 1 } }))
    record(buildRecord({ sessionID: "s1", callID: "c2", decision: "block", reasonCode: "classifier_error", providerID: "p", modelID: "m", durationMs: 20 }))
    const lines = fs.readFileSync(file, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
    const first = JSON.parse(lines[0])
    expect(first.decision).toBe("allow")
    expect(first.callID).toBe("c1")
    expect("command" in first).toBe(false)
    expect(JSON.parse(lines[1]).inputTokens).toBeNull()
  })
})
