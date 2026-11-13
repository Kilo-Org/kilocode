/**
 * Direct children of one session in a loaded family. The transcript palette uses these so agents spawned by the
 * open session get sibling-aware identicons, including when the open session is itself a subagent.
 */
export function sessionChildren(id: string, ids: readonly string[], parentID: (id: string) => string | undefined) {
  return ids.filter((item) => item !== id && parentID(item) === id)
}
