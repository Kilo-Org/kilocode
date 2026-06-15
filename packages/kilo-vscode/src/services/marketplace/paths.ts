import * as os from "os"
import * as path from "path"
import { globalConfigDir } from "../../shared/global-config-dir"

/**
 * Global config dir: ~/.config/kilo/ (same as CLI Global.Path.config via xdg-basedir)
 */

export class MarketplacePaths {
  /** Project-scope config file: <workspace>/.kilo/kilo.json */
  configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "kilo.json")
    return path.join(globalConfigDir(), "kilo.json")
  }

  /** Agent install directory (where marketplace agents are written as .md files). */
  agentsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "agents")
    return path.join(globalConfigDir(), "agents")
  }

  /** Skill install directory (where the marketplace installer writes to). */
  skillsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".kilo", "skills")
    return path.join(os.homedir(), ".kilo", "skills")
  }
}
