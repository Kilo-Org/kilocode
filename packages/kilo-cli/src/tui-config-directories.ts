// Kilo: mirror of packages/tui/src/util/config-directories.ts. The TUI reads custom themes and local plugins from the
// project directories this module names, and upstream names them `.opencode`. Under the Kilo host they are the
// project config directory of Kilo's config discovery, with no fallback to `.opencode`. ./mirrors loads this file in
// place of the upstream one. Keep it in step with the upstream file; test/tui-discovery.test.ts fails on any
// difference that is not marked "Kilo:".
import path from "node:path"
import { stat } from "node:fs/promises"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

// Kilo: the project config directory, the one that config discovery reads (core/src/kilocode/config/discovery.ts).
export const projectConfigName = KiloConfigFiles.directories[0]

export function configDirectories(config: string, cwd: string) {
  return [...new Set([config, ...ancestors(cwd).map((directory) => path.join(directory, projectConfigName))])]
}

export function projectConfigDirectories(project: string, cwd: string) {
  const directories = ancestors(cwd)
  return directories
    .slice(directories.indexOf(path.resolve(project)))
    .map((directory) => path.join(directory, projectConfigName))
}

export async function localProjectDirectory(cwd: string) {
  const directories = ancestors(cwd)
  const repositories = await Promise.all(
    directories.map((directory) =>
      Promise.all(
        [".git", ".hg"].map((name) =>
          stat(path.join(directory, name)).then(
            () => true,
            (error) => (isMissingPath(error) ? false : Promise.reject(error)),
          ),
        ),
      ).then((matches) => matches.some(Boolean)),
    ),
  )
  return directories.findLast((_, index) => repositories[index]) ?? path.resolve(cwd)
}

export function isMissingPath(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? error.code : undefined
  return code === "ENOENT" || code === "ENOTDIR"
}

function ancestors(cwd: string) {
  const directories: string[] = []
  for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
    directories.push(current)
    if (path.dirname(current) === current) break
  }
  return directories.reverse()
}
