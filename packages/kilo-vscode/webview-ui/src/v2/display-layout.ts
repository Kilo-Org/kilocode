import type { DisplaySettings } from "../../../src/protocol"

/** Whether a tool block layout changed. The reasoning mode is not a block layout, so it does not count. */
export function layoutChanged(previous: DisplaySettings, next: DisplaySettings) {
  return (
    previous.terminalCommandDisplay !== next.terminalCommandDisplay ||
    previous.codeEditDisplay !== next.codeEditDisplay ||
    previous.mcpToolDisplay !== next.mcpToolDisplay ||
    previous.codeModeDisplay !== next.codeModeDisplay
  )
}
