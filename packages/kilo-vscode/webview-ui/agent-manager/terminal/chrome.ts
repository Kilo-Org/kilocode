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
