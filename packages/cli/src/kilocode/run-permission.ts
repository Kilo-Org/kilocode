import { EOL } from "node:os"

export type RunError = { type: string; message: string }

const AUTO_REJECTED_PERMISSION = "run ended with an auto-rejected permission; pass --auto for autonomous use"

/**
 * A plain `run` has nobody to answer a permission ask, so it rejects the ask and lets the model
 * continue. Automation must not read that as success, so the run fails with this diagnostic.
 *
 * `--auto` is not counted: it approves asks, and a request that only a person can approve (Kilo's
 * sandbox escalation) is rejected on purpose. That is an expected outcome of an autonomous run.
 */
export function autoRejectedPermissionError(autoRejected: boolean, error: RunError | undefined) {
  if (!autoRejected) return error
  if (!error) return { type: "unknown", message: AUTO_REJECTED_PERMISSION }
  return { type: error.type, message: error.message + EOL + AUTO_REJECTED_PERMISSION }
}
