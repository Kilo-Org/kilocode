import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { ChatRoute, CloudNavigation } from "./route"

// Closing the dialog or switching tabs is not evidence that Cloud rolled back a fork.
const pending = new WeakMap<CloudNavigation, Map<string, string>>()
export function forkIntent(nav: CloudNavigation, route: ChatRoute) {
  const keys = pending.get(nav) ?? new Map<string, string>()
  pending.set(nav, keys)
  const id = JSON.stringify([route.directory, route.scope, route.target.workspaceID, route.target.sessionID])
  const operationKey = keys.get(id) ?? crypto.randomUUID()
  keys.set(id, operationKey)
  return {
    operationKey,
    select(target: KiloHostedRpc.Target) {
      if (
        nav.current() !== route ||
        target.scope !== route.scope ||
        target.workspaceID === route.target.workspaceID ||
        target.sessionID === route.target.sessionID
      )
        return false
      keys.delete(id)
      nav.select({ ...route, target, initial: undefined })
      return true
    },
  }
}
