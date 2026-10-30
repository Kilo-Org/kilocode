// The config files the Settings header offers for one scope. The server's config documents decide the loaded status,
// so a file that exists but is not in `api.config.get` is shown as not loaded. A missing target is the only create
// option, which keeps the quick pick short.
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import type { ConfigScope } from "./protocol"

export interface ConfigCandidate {
  file: string
  name: string
  loaded: boolean
  create: boolean
}

export interface ConfigPickItem {
  label: string
  description: string
  detail: string
  candidate: ConfigCandidate
}

/** The directories whose files belong to one scope, from the server's directory entries. */
export function configDirectories(input: {
  scope: ConfigScope
  target: string
  projectRoot: string
  directories: readonly string[]
  documents: readonly string[]
}): string[] {
  const globalRoots = input.directories.filter((directory) => !isProjectDirectory(directory))
  if (input.scope === "global") return globalRoots.length > 0 ? globalRoots : [path.dirname(input.target)]

  const projects = input.directories.filter(isProjectDirectory)
  const loaded = input.documents.flatMap((file) => {
    const directory = path.dirname(file)
    if (globalRoots.includes(directory)) return []
    if (!KiloConfigFiles.names.includes(path.basename(file)) && !isProjectDirectory(directory)) return []
    return [directory]
  })
  return [...new Set([input.projectRoot, ...projects.map((directory) => path.dirname(directory)), ...projects, ...loaded])]
}

/** Existing candidate files for the scope plus the missing target, with the server document list as loaded status. */
export async function candidateConfigFiles(input: {
  target: string
  directories: readonly string[]
  loaded: ReadonlySet<string>
  exists: (file: string) => Promise<boolean>
}): Promise<ConfigCandidate[]> {
  const paths = new Set<string>()
  for (const directory of input.directories) {
    const names = isProjectDirectory(directory) ? KiloConfigFiles.directoryFiles : KiloConfigFiles.names
    for (const name of names) paths.add(path.join(directory, name))
  }
  paths.add(input.target)

  const found = await Promise.all([...paths].map(async (file) => ({ file, exists: await input.exists(file) })))
  const missing = found.filter((item) => item.file === input.target && !item.exists)
  return [...found.filter((item) => item.exists), ...missing].map((item) => ({
    file: item.file,
    name: path.basename(item.file),
    loaded: item.exists && input.loaded.has(item.file),
    create: !item.exists,
  }))
}

/** Open the only candidate directly, and ask for a choice only when the scope has more than one. */
export async function chooseConfigFile(
  candidates: readonly ConfigCandidate[],
  show: (items: ConfigPickItem[]) => Promise<ConfigPickItem | undefined>,
): Promise<ConfigCandidate | undefined> {
  if (candidates.length === 1) return candidates[0]
  const picked = await show(
    candidates.map((candidate) => ({
      label: `${candidate.create ? "$(add)" : "$(json)"} ${candidate.name}`,
      description: candidate.create ? "Create new" : candidate.loaded ? "Loaded" : "Not loaded",
      detail: candidate.file,
      candidate,
    })),
  )
  return picked?.candidate
}

function isProjectDirectory(directory: string) {
  return KiloConfigFiles.directories.includes(path.basename(directory))
}
