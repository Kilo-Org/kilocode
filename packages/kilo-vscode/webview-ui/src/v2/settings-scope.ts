export type SettingsScope = "global" | "project"

/**
 * The file a write goes to. An explicit scope wins, then the scope that owns the path, then global. A caller that
 * passes no scope must write to the owner, or the project file would shadow an earlier write on the next reload.
 */
export function writeScope(scope: SettingsScope | undefined, owner: SettingsScope | undefined): SettingsScope {
  return scope ?? owner ?? "global"
}
