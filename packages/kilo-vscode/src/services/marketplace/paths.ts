import * as path from "path"
import * as os from "os"

/**
 * Global config dir: ~/.config/kilo/ (XDG_CONFIG_HOME/kilo)
 * This matches where the CLI reads global config from.
 */
function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, "kilo")
}

export class MarketplacePaths {
  /** Project-scope config file: <workspace>/.kilo/kilo.json */
  configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "kilo.json")
    return path.join(globalConfigDir(), "kilo.json")
  }

  skillsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "skills")
    return path.join(os.homedir(), ".kilo", "skills")
  }
}
