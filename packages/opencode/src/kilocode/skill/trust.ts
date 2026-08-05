import { realpathSync } from "fs"
import path from "path"

// A skill discovered under a trusted directory (~/.agents, ~/.claude, config dirs,
// KILO_CONFIG_DIR) mints trust: shell execution after one approval, and unconfined
// {env:}/{file:} substitution. Symlinks are followed during the scan, so a link from a
// trusted dir into the current project (a commonly suggested convenience) would otherwise
// grant project-controlled markdown that trust. Resolve the real path and drop trust when
// it lands inside the project, so project content is never trusted regardless of symlinks.
export function trustedInProject(match: string, projectRoot: string | undefined): boolean {
  if (!projectRoot) return false
  const real = (() => {
    try {
      return realpathSync.native(match)
    } catch {
      return match
    }
  })()
  const root = (() => {
    try {
      return realpathSync.native(projectRoot)
    } catch {
      return projectRoot
    }
  })()
  const rel = path.relative(root, real)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}
