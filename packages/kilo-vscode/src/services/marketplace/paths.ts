import * as path from "path"
import * as os from "os"

const kiloDir = () => path.join(os.homedir(), ".kilo")

export class MarketplacePaths {
  projectModesPath(workspace: string) {
    return path.join(workspace, ".kilocodemodes")
  }

  projectMcpPath(workspace: string) {
    return path.join(workspace, ".kilo", "mcp.json")
  }

  projectSkillsDir(workspace: string) {
    return path.join(workspace, ".kilo", "skills")
  }

  globalModesPath() {
    return path.join(os.homedir(), ".kilocodemodes")
  }

  globalMcpPath() {
    return path.join(kiloDir(), "mcp.json")
  }

  globalSkillsDir() {
    return path.join(kiloDir(), "skills")
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
