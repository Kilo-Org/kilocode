export interface WorkspaceFolderLike {
  uri: { fsPath: string }
}

export function resolvePanelProjectDirectory(
  active: string | undefined,
  folders: readonly WorkspaceFolderLike[] | undefined,
): string | null {
  if (active) return active
  if (folders?.length === 1) return folders[0].uri.fsPath
  return null
}
