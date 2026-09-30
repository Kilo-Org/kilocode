import { Schema } from "effect"
import type * as Tool from "@/tool/tool"
import type { BlockedResult, SecurityDecision } from "./types"

/**
 * Raised inside `ctx.ask` when the security engine denies an action. Tools die with it exactly like
 * a permission denial; the execution gate turns it into a structured, non-fatal tool result so the
 * agent can continue safely.
 */
export class SecurityDeniedError extends Schema.TaggedErrorClass<SecurityDeniedError>()("SecurityDeniedError", {
  permission: Schema.String,
  reasonCode: Schema.String,
  summary: Schema.String,
  guidance: Schema.String,
  canRetry: Schema.Boolean,
  alternatives: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Blocked by the security policy (${this.reasonCode}): ${this.summary} ${this.guidance}`.trim()
  }

  static fromDecision(permission: string, decision: SecurityDecision) {
    return new SecurityDeniedError({
      permission,
      reasonCode: decision.reasonCode,
      summary: decision.message,
      guidance: decision.guidance,
      canRetry: decision.canRetry,
      alternatives: decision.alternatives.map((item) => item.description),
    })
  }

  static isInstance(value: unknown): value is SecurityDeniedError {
    return value instanceof SecurityDeniedError
  }

  blocked(): BlockedResult {
    return {
      status: "blocked",
      decision: "deny",
      reasonCode: this.reasonCode as BlockedResult["reasonCode"],
      message: this.summary,
      canRetry: this.canRetry,
      alternatives: [...this.alternatives],
    }
  }

  /** Structured tool result: the agent reads the reason and continues instead of failing the turn. */
  result(tool: string): Tool.ExecuteResult {
    const blocked = this.blocked()
    const lines = [
      `The ${tool} call was blocked by the security policy and was not executed.`,
      `Reason (${blocked.reasonCode}): ${blocked.message}`,
      this.guidance,
      ...(blocked.alternatives.length > 0
        ? ["Safe alternatives:", ...blocked.alternatives.map((item) => `- ${item}`)]
        : []),
      blocked.canRetry
        ? "You may continue with a different approach; do not retry the same action."
        : "Do not retry this action.",
    ].filter((line) => line.length > 0)
    return {
      title: "Blocked by security policy",
      metadata: { security: blocked },
      output: [lines.join("\n"), "", "```json", JSON.stringify(blocked, null, 2), "```"].join("\n"),
    }
  }
}
