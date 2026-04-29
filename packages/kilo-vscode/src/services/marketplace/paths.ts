import * as path from "path"
import * as os from "os"

/**
 * Global config dir: ~/.config/kilo/ (XDG_CONFIG_HOME/kilo)
 * KILO_GLOBAL_CONFIG_DIR wins when set; KILO_DEV uses 'kilo-dev'.
 */
function globalConfigDir(): string {
  if (process.env.KILO_GLOBAL_CONFIG_DIR) return process.env.KILO_GLOBAL_CONFIG_DIR.trim()
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  const app = process.env.KILO_DEV ? "kilo-dev" : "kilo"
  return path.join(xdg.trim(), app)
}

export class MarketplacePaths {
  /** Project-scope config file: <workspace>/.kilo/kilo.json */
  configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "kilo.json")
    return path.join(globalConfigDir(), "kilo.json")
  }

  /** Skill install directory (where the marketplace installer writes to). */
  skillsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "skills")
    return path.join(os.homedir(), ".kilo", "skills")
  }
}
