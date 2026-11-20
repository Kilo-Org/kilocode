export * as KiloPermission from "./permission.js"

/**
 * True for a permission request only a person may answer. Kilo plugins set `metadata.interactive` on such requests (a
 * sandbox escalation, a sensitive browser step), so an auto-approve path leaves them for the user and a
 * non-interactive run rejects them. Only the literal `true` counts: a missing, string or numeric value is an
 * ordinary request.
 */
export function requiresPerson(metadata: Record<string, unknown> | undefined) {
  return metadata?.["interactive"] === true
}
