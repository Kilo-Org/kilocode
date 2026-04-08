import { createStore, unwrap } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

// devilcode_change start
export type DevilClawRoute = {
  type: "kiloclaw"
}

export type WorkflowRoute = {
  type: "workflow"
  initialAction?: string
}
// devilcode_change end

export type Route = HomeRoute | SessionRoute | DevilClawRoute | WorkflowRoute // devilcode_change

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      process.env["DEVIL_ROUTE"]
        ? JSON.parse(process.env["DEVIL_ROUTE"])
        : {
            type: "home",
          },
    )

    // devilcode_change start
    let previous: Route | undefined
    // devilcode_change end

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        console.log("navigate", route)
        previous = structuredClone(unwrap(store)) // devilcode_change
        setStore(route)
      },
      // devilcode_change start
      back() {
        const target = previous ?? ({ type: "home" } as const)
        previous = undefined
        console.log("navigate", target)
        setStore(target)
      },
      // devilcode_change end
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
