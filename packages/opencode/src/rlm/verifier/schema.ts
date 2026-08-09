/**
 * Sara RLM — Verifier Schema (Phase 3)
 *
 * Structured output types for the verifier.
 */

export interface Finding {
  readonly key: string
  readonly severity: "info" | "warning" | "error" | "critical"
  readonly description: string
}

export interface RLMVerification {
  readonly verdict: "pass" | "reinvestigate" | "fail"
  /** 0-1 confidence score */
  readonly confidence: number
  readonly reasoning: string
  readonly findings: readonly Finding[]
  /** Sibling indices of tasks that should be re-executed */
  readonly targetTasks: readonly number[]
}

/** Validate a verification output */
export function validateVerification(v: unknown): string[] {
  const errors: string[] = []
  if (!v || typeof v !== "object") return ["Verification must be an object"]
  const obj = v as Record<string, unknown>

  if (!["pass", "reinvestigate", "fail"].includes(obj.verdict as string)) {
    errors.push(`Invalid verdict: ${String(obj.verdict)}`)
  }

  const confidence = Number(obj.confidence)
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    errors.push(`Invalid confidence: ${confidence}`)
  }

  if (typeof obj.reasoning !== "string" || obj.reasoning.trim().length === 0) {
    errors.push("Reasoning must be a non-empty string")
  }

  if (!Array.isArray(obj.findings)) {
    errors.push("Findings must be an array")
  } else {
    for (const f of obj.findings) {
      if (!f.key || typeof f.key !== "string") errors.push("Finding key must be a non-empty string")
      if (!["info", "warning", "error", "critical"].includes(f.severity)) errors.push(`Invalid severity: ${String(f.severity)}`)
    }
  }

  if (!Array.isArray(obj.targetTasks)) {
    errors.push("targetTasks must be an array")
  } else {
    for (const t of obj.targetTasks) {
      if (typeof t !== "number" || !Number.isInteger(t) || t < 0) errors.push(`Invalid targetTask: ${t}`)
    }
  }

  return errors
}