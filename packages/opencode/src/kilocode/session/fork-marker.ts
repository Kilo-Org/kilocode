// Marker carried by /btw fork sessions so permission assembly can treat their
// session ruleset as the complete policy instead of re-merging agent rules.
export const BTW_FORK = "kilocodeBtwFork"

export function markBtwFork(metadata: Record<string, unknown> | undefined) {
  return { ...(metadata ?? {}), [BTW_FORK]: true }
}

export function isBtwFork(metadata: Record<string, unknown> | undefined) {
  return metadata?.[BTW_FORK] === true
}
