import type { ScriptTerminalStatus } from "./state"

export type TerminalChromeIcon = "console" | "spinner" | "success" | "failure"

export interface TerminalChrome {
  icon: TerminalChromeIcon
  tooltip: string
}

/** Keep Run status in the existing tab chrome rather than adding another layout. */
export function terminalChrome(title: string, status: ScriptTerminalStatus | undefined): TerminalChrome {
  if (!status) return { icon: "console", tooltip: title }
  if (status.state === "running") return { icon: "spinner", tooltip: `${title} (Running)` }
  if (status.state === "stopping") return { icon: "spinner", tooltip: `${title} (Stopping)` }
  if (status.state === "exited" && status.exitCode === 0)
    return { icon: "success", tooltip: `${title} (Exited, code 0)` }
  if (status.state === "exited")
    return { icon: "failure", tooltip: `${title} (Exited, code ${status.exitCode ?? "unknown"})` }
  return {
    icon: "failure",
    tooltip: `${title} (Failed${status.exitCode === undefined ? "" : `, code ${status.exitCode}`})`,
  }
}

/**
 * A running Setup script must finish (or time out) on its own: closing its
 * tab would silently kill worktree provisioning. Run tabs stay closable
 * because close means stop there.
 */
export function terminalClosable(status: ScriptTerminalStatus | undefined): boolean {
  if (status?.kind !== "setup") return true
  return status.state !== "running" && status.state !== "stopping"
}

/**
 * A running Setup script can always be stopped deliberately: the stop
 * action kills the process tree and worktree creation continues without
 * it, which is the escape hatch for scripts that run too long.
 */
export function terminalStoppable(status: ScriptTerminalStatus | undefined): boolean {
  return status?.kind === "setup" && status.state === "running"
}
