export type SettingsScope = "global" | "project"

/**
 * The file a write goes to. An explicit scope wins without consulting the files. Otherwise wait for the raw files,
 * which are unknown until the first `configLoaded`, then use the scope that owns the path, then global. A write that
 * starts before the files load would otherwise fall back to global and land in the file the project value shadows.
 */
export async function writeScope(
  scope: SettingsScope | undefined,
  waitForFiles: () => Promise<void>,
  owner: () => SettingsScope | undefined,
): Promise<SettingsScope> {
  if (scope) return scope
  await waitForFiles()
  return owner() ?? "global"
}
