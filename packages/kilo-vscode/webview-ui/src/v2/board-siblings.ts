/**
 * The direct subagents of a board family root. A board post can address any participant of the root's family, so a
 * subagent transcript must use the root's children, not the subagent's own children, for sibling-aware identicons.
 */
export function boardSiblings(root: string, ids: readonly string[], parentID: (id: string) => string | undefined) {
  return ids.filter((id) => id !== root && parentID(id) === root)
}
