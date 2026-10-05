import type { WorkspaceFolder } from "../types/messages"

const norm = (value: string) => {
  const slashed = value.replaceAll("\\", "/").replace(/\/+$/, "")
  // Drive-letter paths come from Windows, where paths compare case-insensitively.
  return /^[a-zA-Z]:/.test(slashed) ? slashed.toLowerCase() : slashed
}

/** The workspace folder that contains `dir`, preferring the deepest when folders nest. */
export function folderOf(dir: string | undefined, folders: readonly WorkspaceFolder[]): WorkspaceFolder | undefined {
  if (!dir) return undefined
  const target = norm(dir)
  return folders
    .filter((folder) => {
      const root = norm(folder.path)
      return target === root || target.startsWith(`${root}/`)
    })
    .reduce<WorkspaceFolder | undefined>(
      (best, folder) => (!best || folder.path.length > best.path.length ? folder : best),
      undefined,
    )
}
