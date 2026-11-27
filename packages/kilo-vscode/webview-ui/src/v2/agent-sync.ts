import type { V2 } from "./scope"

type AgentSyncScope = Pick<V2, "directory" | "connection" | "data" | "report">

/**
 * On a cold Location, initial `agent.sync()` returns `[]` before plugins finish activating.
 * `createData` debounces `agent.updated` by 150 ms (`settleMs`), so while the agent list is still
 * empty, refetch immediately on the first `agent.updated` event for this directory.
 */
export function syncAgentsOnColdActivation(scope: AgentSyncScope): () => void {
  if (typeof scope.data.on !== "function") return () => {}
  return scope.data.on("agent.updated", (event) => {
    if (event.location && event.location.directory !== scope.directory) return
    if (scope.connection.status() !== "connected") return
    if ((scope.data.location.agent.list()?.length ?? 0) > 0) return
    scope.data.location.agent.invalidate()
    void scope.data.location.agent.sync().catch(scope.report)
  })
}
