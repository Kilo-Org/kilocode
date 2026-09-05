import type { CliRenderer } from "@opentui/core"

export function destroyRenderer(
  renderer: Pick<CliRenderer, "isDestroyed" | "screenMode" | "setTerminalTitle" | "destroy">,
) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  renderer.screenMode = "main-screen" // kilocode_change - restore the shell before the host prints its epilogue
  renderer.destroy()
}
