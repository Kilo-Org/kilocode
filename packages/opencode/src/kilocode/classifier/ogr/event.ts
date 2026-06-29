import type { GuardEvent } from "@openguardrails/core"
import { OGR_VERSION } from "@openguardrails/core"
import type { ClassifierAction, JudgePolicy, TranscriptEntry } from "../types"

// kilocode_change start — build an OGR GuardEvent for the command-approval gate (issue #9138)

let seq = 0
function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`
}

/**
 * Build the OGR `GuardEvent` for a would-auto-approve tool call. Modeled as a
 * `tool_call` observed at the `agent_hook` altitude. The deterministic
 * `ConfigRulesDetector` reads `payload.name` + `payload.arguments`; the
 * `OwnModelJudge` reads the reasoning-blind `transcript` + `action` + `judgePolicy`
 * carried alongside.
 */
export function buildGuardEvent(opts: {
  tool: string
  action: ClassifierAction
  transcript: TranscriptEntry[]
  judgePolicy: JudgePolicy
  sessionId: string
}): GuardEvent {
  const guardId = id("g")
  return {
    kind: "tool_call",
    observationPoint: "agent_hook",
    subject: { tool: opts.tool },
    payload: {
      // consumed by ConfigRulesDetector (SHELL_TOOLS → arguments.command)
      name: opts.tool,
      arguments: opts.action.input as Record<string, unknown>,
      // consumed by OwnModelJudge
      transcript: opts.transcript,
      action: opts.action,
      judgePolicy: opts.judgePolicy,
    },
    eventId: id("e"),
    guardId,
    timestamp: new Date().toISOString(),
    sessionId: opts.sessionId,
    // Reasoning-blind: tool outputs are excluded, so we can't taint from them
    // here. The action originates from the model and is treated as unverified;
    // input-layer provenance tainting is a follow-up (see PR notes).
    provenance: [{ source: "model", trust: "unverified" }],
    ogrVersion: OGR_VERSION,
  }
}

// kilocode_change end
