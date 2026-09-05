/**
 * Shared permission helpers used by the TUI app and the settings dialog.
 *
 * Lives in its own module so neither `app.tsx` nor `dialog-settings/` has to
 * import the other just to check the auto-approve flag.
 */

export function isAllowEverything(permission: unknown): boolean {
  if (typeof permission !== "object" || permission === null) return false
  const wildcard = (permission as Record<string, unknown>)["*"]
  if (typeof wildcard === "string") return wildcard === "allow"
  if (typeof wildcard === "object" && wildcard !== null)
    return (wildcard as Record<string, unknown>)["*"] === "allow"
  return false
}
