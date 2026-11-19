import type { ChatRoute, CloudNavigation } from "./route"
import type { CloudSessionPool } from "./session-pool"
import type { Activity } from "../v2/activity"

type Observation = { key: string; projectId: string; title: string; state: Activity; selected: boolean }

/** The shared status list observes already authorized leases. Reading or searching never attaches a chat. */
export function createCloudStatus(
  nav: Pick<CloudNavigation, "opened" | "current" | "select">,
  pool: Pick<CloudSessionPool, "observed">,
  allowed: (route: ChatRoute) => boolean,
) {
  const keys = new WeakMap<ChatRoute, string>()
  let next = 0
  function key(route: ChatRoute) {
    const existing = keys.get(route)
    if (existing) return existing
    const value = `cloud-status:${++next}`
    keys.set(route, value)
    return value
  }
  const observed = (route: ChatRoute) => (allowed(route) ? pool.observed(route.directory, route.target) : undefined)
  return {
    rows(): Observation[] {
      return nav.opened().flatMap((route) => {
        const state = observed(route)
        return state
          ? [
              {
                key: key(route),
                projectId: route.projectID,
                title: route.title,
                state,
                selected: nav.current() === route,
              },
            ]
          : []
      })
    },
    select(id: string) {
      const route = nav.opened().find((route) => keys.get(route) === id)
      if (route && observed(route)) nav.select(route)
    },
  }
}
export type CloudStatus = ReturnType<typeof createCloudStatus>
