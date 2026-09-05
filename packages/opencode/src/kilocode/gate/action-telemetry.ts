// kilocode_change - Redacted classifier telemetry. Captures ONLY latency + token cost + verdict, keyed
// by session id and a tool-call id, for the benchmark. It NEVER records the user intent, the shell
// command, or its args — the record shape has no field for them, and this is the only place classifier
// telemetry is written. Exactly ONE terminal record is emitted per classifier invocation (allow /
// block / timeout / malformed / error / unavailable). Enabled by pointing KILO_CLASSIFIER_TELEMETRY at
// a file path; a no-op (and never throws) otherwise.
import fs from "node:fs"

export interface ClassifierTelemetry {
  readonly ts: string
  /** session id — the benchmark runner maps this to a (config, scenario) cell. */
  readonly sessionID: string
  /** tool-call id — correlates the verdict with a specific tool-part. */
  readonly callID: string
  readonly decision: "allow" | "block" | "ask"
  readonly reasonCode: string
  /** "providerID/modelID" — no secrets. */
  readonly model: string
  /** wall time from classifier entry (incl. model resolution) to terminal verdict. */
  readonly durationMs: number
  /** null when the model call did not complete (timeout / error / unavailable). */
  readonly inputTokens: number | null
  readonly outputTokens: number | null
}

/** Explicit allowlist of fields ever written — a guard so no raw intent/command/args can leak in. */
const ALLOWED_KEYS = [
  "ts",
  "sessionID",
  "callID",
  "decision",
  "reasonCode",
  "model",
  "durationMs",
  "inputTokens",
  "outputTokens",
] as const

/** Build the redacted record from raw inputs. Pure — unit-tested to prove it carries no forbidden field. */
export function buildRecord(input: {
  sessionID: string
  callID?: string
  decision: "allow" | "block" | "ask"
  reasonCode: string
  providerID: string
  modelID: string
  durationMs: number
  usage?: { inputTokens?: number; outputTokens?: number }
}): ClassifierTelemetry {
  return {
    ts: new Date().toISOString(),
    sessionID: input.sessionID,
    callID: input.callID ?? "",
    decision: input.decision,
    reasonCode: input.reasonCode,
    model: `${input.providerID}/${input.modelID}`,
    durationMs: Math.round(input.durationMs),
    inputTokens: input.usage?.inputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
  }
}

/** True iff the object contains only allowlisted keys (defense-in-depth check, used by tests). */
export function isRedacted(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((k) => (ALLOWED_KEYS as readonly string[]).includes(k))
}

/** File the telemetry is appended to, or undefined when disabled. Re-read each call so it is testable. */
export function sinkPath(): string | undefined {
  return process.env["KILO_CLASSIFIER_TELEMETRY"]
}

/** Append one redacted record as JSONL. Telemetry must NEVER break the gate, so all errors are swallowed. */
export function record(event: ClassifierTelemetry): void {
  const path = sinkPath()
  if (!path) return
  try {
    fs.appendFileSync(path, JSON.stringify(event) + "\n")
  } catch {
    // ignore — a telemetry failure must not affect the security verdict
  }
}
