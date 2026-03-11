import * as path from "path"
import * as os from "os"

export class MarketplacePaths {
  constructor(private storage: string) {}

  projectModesPath(workspace: string) {
    return path.join(workspace, ".kilocodemodes")
  }

  projectMcpPath(workspace: string) {
    return path.join(workspace, ".kilocode", "mcp.json")
  }

  projectSkillsDir(workspace: string) {
    return path.join(workspace, ".kilocode", "skills")
  }

  globalModesPath() {
    return path.join(this.storage, "settings", "custom_modes.yaml")
  }

  globalMcpPath() {
    return path.join(this.storage, "settings", "mcp_settings.json")
  }

  globalSkillsDir() {
    return path.join(os.homedir(), ".kilocode", "skills")
  }

  modesPath(scope: "project" | "global", workspace?: string) {
    if (scope === "project") return this.projectModesPath(workspace!)
    return this.globalModesPath()
  }

  mcpPath(scope: "project" | "global", workspace?: string) {
    if (scope === "project") return this.projectMcpPath(workspace!)
    return this.globalMcpPath()
  }

  skillsDir(scope: "project" | "global", workspace?: string) {
    if (scope === "project") return this.projectSkillsDir(workspace!)
    return this.globalSkillsDir()
  }
}
