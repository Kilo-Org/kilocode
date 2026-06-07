// Opens the Browser Canvas (the running app) next to the terminal. Best-effort
// and cross-platform; failure to open is non-fatal (the user can open it).

import { Process } from "@/util/process"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "design.browser" })

function openCommand(url: string): string[] {
  if (process.platform === "darwin") return ["open", url]
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url]
  return ["xdg-open", url]
}

export function openCanvas(url: string): void {
  try {
    const proc = Process.spawn(openCommand(url), { stdout: "ignore", stderr: "ignore" })
    proc.exited.catch(() => {})
  } catch (err) {
    log.warn("failed to open browser canvas", { url, err })
  }
}
