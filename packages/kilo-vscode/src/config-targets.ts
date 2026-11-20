// Resolves the writable global and project Kilo config files from the server's config document list. The project
// target never depends on the global directory; a missing global directory entry falls back to the path the spawned
// server uses, and the writer creates it.
import path from "node:path"
import { activeProfile, configFiles } from "./active-profile"
import { canonicalPath, matchConfigDocument, resolveGlobalConfigDir } from "./settings-paths"

export type ConfigEntry = {
  type: "document" | "directory"
  path?: string
}

export async function configTargets(input: {
  entries: ConfigEntry[]
  directory: string
  profile: string
}): Promise<{ global: string; project: string }> {
  const documents = new Map<string, string>()
  const directories: string[] = []
  for (const entry of input.entries) {
    if (!entry.path) continue
    const real = await canonicalPath(entry.path)
    if (entry.type === "document") documents.set(real, entry.path)
    else directories.push(real)
  }

  const projectRoot = await canonicalPath(input.directory)
  const files = configFiles()
  const project =
    (await matchConfigDocument(files.writeCandidates(projectRoot, false), documents)) ??
    path.join(projectRoot, files.newFile)
  const globalDir = await canonicalPath(
    activeProfile?.config ??
      directories.find((directory) => !files.directories.includes(path.basename(directory))) ??
      resolveGlobalConfigDir(process.env, input.profile),
  )
  const global =
    (await matchConfigDocument(files.writeCandidates(globalDir, true), documents)) ??
    path.join(globalDir, files.newFile)
  return { global, project }
}
