/**
 * Where the Agent Manager Run button executes the project run script.
 *
 * "agentManager" (default) runs through the canonical PTY service in the
 * embedded side terminal. "vscode" is the legacy integrated terminal task
 * path, kept for comparison while the embedded path proves itself. Remove
 * the "vscode" option, `run/task.ts`, and the integrated branch below
 * together once the embedded path is the only one.
 */

import type { StartTask } from "./controller"

export type RunTerminalDestination = "agentManager" | "vscode"

/** Unknown values fall back to the embedded Agent Manager terminal. */
export function resolveRunTerminalDestination(value: unknown): RunTerminalDestination {
  return value === "vscode" ? "vscode" : "agentManager"
}

export function pickRunStart(
  destination: RunTerminalDestination,
  embedded: StartTask,
  integrated: StartTask,
): StartTask {
  return destination === "vscode" ? integrated : embedded
}
