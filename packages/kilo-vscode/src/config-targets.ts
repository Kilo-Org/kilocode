// Resolves the writable global and project Kilo config files from the server's config document list. The project
// target never depends on the global directory; a missing global directory entry falls back to the path the spawned
// server uses, and the writer creates it.
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
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
  const project =
    (await matchConfigDocument(KiloConfigFiles.writeCandidates(projectRoot, false), documents)) ??
    path.join(projectRoot, KiloConfigFiles.newFile)
  const globalDir = await canonicalPath(
    directories.find((directory) => !KiloConfigFiles.directories.includes(path.basename(directory))) ??
      resolveGlobalConfigDir(process.env, input.profile),
  )
  const global =
    (await matchConfigDocument(KiloConfigFiles.writeCandidates(globalDir, true), documents)) ??
    path.join(globalDir, KiloConfigFiles.newFile)
  return { global, project }
}
