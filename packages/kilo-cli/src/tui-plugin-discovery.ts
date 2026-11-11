// Kilo: mirror of packages/tui/src/plugin/discovery.ts, which the TUI and `plugin list` use to find local plugins.
// Upstream always lists the project root's `.opencode/plugins`; under the Kilo host it is the plugins directory of
// Kilo's project config directory. ./mirrors loads this file in place of the upstream one. Keep it in step with the
// upstream file; test/tui-discovery.test.ts fails on any difference that is not marked "Kilo:".
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { localSource } from "@opencode/plugin/source"
// Kilo: the mirror of the directory helpers, with Kilo's project config directory name.
import {
  isMissingPath,
  localProjectDirectory,
  projectConfigDirectories,
  projectConfigName,
} from "./tui-config-directories"

export { localSource }

export async function localPluginDirectories(cwd: string, configDirectory: string) {
  const projectDirectory = await localProjectDirectory(cwd)
  const projectConfig = path.join(projectDirectory, projectConfigName)
  const directories = [configDirectory, ...projectConfigDirectories(projectDirectory, cwd)]
  const exists = await Promise.all(
    directories.map(async (directory) => {
      if (directory === configDirectory || directory === projectConfig) return true
      return await stat(directory).then(
        (info) => info.isDirectory(),
        (error) => (isMissingPath(error) ? false : Promise.reject(error)),
      )
    }),
  )
  return directories.filter((_, index) => exists[index]).map((directory) => path.join(directory, "plugins"))
}

export async function discoverPluginTargets(directories: string[]) {
  return (
    await Promise.all(
      directories.map(async (directory) => {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if (isMissingPath(error)) return []
          return Promise.reject(error)
        })
        return (
          await Promise.all(
            entries
              .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(async (entry): Promise<string | undefined> => {
                const plugin = path.join(directory, entry.name)
                const isDirectory =
                  entry.isDirectory() ||
                  (await stat(plugin).then(
                    (info) => info.isDirectory(),
                    (error) => (isMissingPath(error) ? false : Promise.reject(error)),
                  ))
                if (!isDirectory) return undefined
                return plugin
              }),
          )
        ).filter((entry): entry is string => entry !== undefined)
      }),
    )
  ).flat()
}

export function mergePluginTargets<const Target extends { readonly entry: string | { readonly package: string } }>(
  targets: readonly Target[],
  directory: string,
) {
  return [
    ...targets
      .reduce((result, target) => {
        const value = typeof target.entry === "string" ? target.entry : target.entry.package
        return result.set(localSource(value, directory)?.href ?? value, target)
      }, new Map<string, Target>())
      .values(),
  ]
}
