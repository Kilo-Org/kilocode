/**
 * Where the Agent Manager Run button executes the project run script.
 *
 * The Agent Manager terminal dropdown owns this choice per panel.
 * "agentManager" runs through the canonical PTY service in the embedded
 * side terminal. "vscode" is the legacy integrated terminal task path,
 * kept for comparison while the embedded path proves itself. Remove the
 * "vscode" dropdown option, `run/task.ts`, and the integrated branch below
 * together once the embedded path is the only one.
 */

export type RunTerminalDestination = "agentManager" | "vscode"

export function pickRunStart<T>(destination: RunTerminalDestination, embedded: T, integrated: T): T {
  return destination === "vscode" ? integrated : embedded
}
