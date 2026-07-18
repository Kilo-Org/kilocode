export type ProjectLifecycleState = "active" | "unavailable" | "removed"

export type ProjectLifecycleEvent = { type: "missing" } | { type: "relink" } | { type: "remove" }

export function initialProjectLifecycle(): ProjectLifecycleState {
  return "active"
}

export function transitionProjectLifecycle(
  state: ProjectLifecycleState,
  event: ProjectLifecycleEvent,
): ProjectLifecycleState {
  if (state === "removed") return "removed"
  if (event.type === "remove") return "removed"
  if (state === "active" && event.type === "missing") return "unavailable"
  if (state === "unavailable" && event.type === "relink") return "active"
  return state
}
