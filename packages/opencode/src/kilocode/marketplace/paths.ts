import path from "path"
import { Global } from "@opencode-ai/core/global"
import { KilocodeConfigOverlay } from "@/kilocode/config/overlay"
import type { Scope } from "./schema"

export async function configPath(scope: Scope, directory: string, worktree?: string) {
  if (scope === "global") return KilocodeConfigOverlay.globalTarget()
  return KilocodeConfigOverlay.projectTarget({ directory, worktree })
}

export function agentsDir(scope: Scope, directory: string) {
  if (scope === "global") return path.join(Global.Path.config, "agents")
  return path.join(directory, ".kilo", "agents")
}

export function skillsDir(scope: Scope, directory: string) {
  if (scope === "global") return path.join(Global.Path.home, ".kilo", "skills")
  return path.join(directory, ".kilo", "skills")
}

export function configRoot(scope: Scope, directory: string) {
  if (scope === "global") return Global.Path.config
  return path.join(directory, ".kilo")
}
