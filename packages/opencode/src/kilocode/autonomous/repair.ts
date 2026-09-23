import type { AutonomousConfig } from "./config"
import { AutonomousShell } from "./shell"
import type { AutonomousState } from "./state"

/**
 * Repair policy. A failed attempt is retried locally, escalated to the cloud
 * model when the task is stuck or exhausted, and failed after the cloud attempt.
 */
export namespace AutonomousRepair {
  export type Action = "retry" | "escalate" | "fail"
  export type Decision = { action: Action; reason: string }

  export function fingerprint(stage: AutonomousState.Stage, message: string) {
    const line = message
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
    return `${stage}:${line.replace(/\d+/g, "N").replace(/\s+/g, " ").slice(0, 200)}`
  }

  export function record(
    task: AutonomousState.Task,
    input: { stage: AutonomousState.Stage; message: string; modelClass: AutonomousState.ModelClass; fingerprint?: string },
  ) {
    const failure: AutonomousState.Failure = {
      attempt: task.attempts,
      stage: input.stage,
      fingerprint: input.fingerprint ?? fingerprint(input.stage, input.message),
      message: AutonomousShell.truncate(input.message, 4000),
      modelClass: input.modelClass,
    }
    task.failures.push(failure)
    return failure
  }

  export function decide(task: AutonomousState.Task, cfg: AutonomousConfig.Info): Decision {
    const last = task.failures.at(-1)
    if (!last) return { action: "retry", reason: "no failure recorded" }
    const same = last.fingerprint ? task.failures.filter((f) => f.fingerprint === last.fingerprint).length : 1
    const stuck = same >= cfg.stuck.same_error_limit
    const exhausted = task.attempts >= task.maxAttempts
    const blocked = last.stage === "worker"
    const cloud = last.modelClass === "cloud-reasoner"
    if (cloud) {
      if (blocked) return { action: "fail", reason: "cloud worker reported the task as blocked" }
      if (stuck) return { action: "fail", reason: `same failure ${same} times, including with the cloud model` }
      if (exhausted) return { action: "fail", reason: `no attempts left after cloud escalation (${task.attempts})` }
      return { action: "retry", reason: "retrying with the cloud model" }
    }
    if (blocked) return { action: "escalate", reason: "worker reported the task as blocked" }
    if (stuck) return { action: "escalate", reason: `same failure ${same} times` }
    if (exhausted) return { action: "escalate", reason: `local attempts exhausted (${task.attempts} of ${task.maxAttempts})` }
    return { action: "retry", reason: `attempt ${task.attempts} of ${task.maxAttempts} failed` }
  }

  /** Extra guidance for the next worker run, derived from the last failure. */
  export function instructions(task: AutonomousState.Task) {
    const last = task.failures.at(-1)
    if (!last) return undefined
    const head =
      last.stage === "check"
        ? "The mechanical checks failed after your last attempt. Make them pass without disabling or deleting tests."
        : last.stage === "review"
          ? "The reviewer rejected the last attempt. Address every blocking finding."
          : last.stage === "worker"
            ? "The previous worker reported the task as blocked. Reconsider the approach and find a safe way to complete it."
            : "The escalated attempt failed. Fix the root cause."
    return `${head}\n\n${AutonomousShell.truncate(last.message, 6000)}`
  }
}
