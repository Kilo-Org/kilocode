import * as os from "os"
import * as path from "path"

/** Matches @opencode-ai/core/global Path.config (xdgConfig + "/kilo"). */
function xdgConfigHome() {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME
  return path.join(os.homedir(), ".config")
}

export function globalConfigDir() {
  return path.join(xdgConfigHome(), "kilo")
}
