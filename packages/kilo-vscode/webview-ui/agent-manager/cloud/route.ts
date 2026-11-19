import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { strongest, type Activity } from "../v2/activity"
import { batch, createSignal } from "solid-js"
export type HostedChoice = KiloHostedRpc.Create["agent"]

export type CloudProject = {
  projectID: string
  directory: string
  repository: string
  scope: string
  restoreKey?: string
}
export type CreateRoute = CloudProject & { kind: "create"; workspaceID?: string; workspaceName?: string }
export type ChatRoute = CloudProject & {
  kind: "session"
  target: KiloHostedRpc.Target
  title: string
  initial?: HostedChoice
}
export type CloudRoute = CreateRoute | ChatRoute

/** Native selection, tab memory, terminal context and session presence must never receive a hosted session ID. */
export function createCloudNavigation(
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  live?: (directory: string, target: KiloHostedRpc.Target) => Activity,
) {
  const key = "agent-manager.cloud.active"
  let restoreKey = storage?.getItem(key)
  const identity = (r: ChatRoute) => JSON.stringify([r.directory, r.scope, r.target.workspaceID, r.target.sessionID])
  const bookmark = (r: ChatRoute) =>
    JSON.stringify([r.directory, r.restoreKey ?? r.scope, r.target.workspaceID, r.target.sessionID])
  const visits = new Set<string>()
  const [activity, setActivity] = createSignal<{ route: CloudRoute; state: Activity }>()
  function report(route: CloudRoute, state: Activity) {
    if (current() === route) setActivity({ route, state })
  }
  const state = (route: CloudRoute): Activity =>
    route.kind === "session"
      ? (live?.(route.directory, route.target) ?? "idle")
      : activity()?.route === route
        ? activity()!.state
        : "idle"
  const [current, setCurrent] = createSignal<CloudRoute>()
  const [opened, setOpened] = createSignal<ChatRoute[]>([])
  const [closed, setClosed] = createSignal<ChatRoute[]>([])
  const recent = new Map<string, string>()
  const group = (r: ChatRoute) => JSON.stringify([r.directory, r.scope, r.target.workspaceID])
  const tabs = () => {
    const route = current()
    if (!route) return []
    const workspace = route.kind === "session" ? route.target.workspaceID : route.workspaceID
    return opened().filter(
      (t) => t.directory === route.directory && t.scope === route.scope && t.target.workspaceID === workspace,
    )
  }
  function select(route: CloudRoute) {
    if (route.kind === "session") {
      visits.delete(identity(route))
      visits.add(identity(route))
      if (visits.size > 100) visits.delete(visits.keys().next().value!)
      recent.set(group(route), identity(route))
      setClosed((prev) => prev.filter((r) => identity(r) !== identity(route)))
      setOpened((prev) => {
        const index = prev.findIndex(
          (t) =>
            t.directory === route.directory &&
            t.scope === route.scope &&
            t.target.sessionID === route.target.sessionID &&
            t.target.workspaceID === route.target.workspaceID,
        )
        return index < 0 ? [...prev, route] : prev.map((t, i) => (i === index ? route : t))
      })
    }
    restoreKey = undefined
    if (route.kind === "session") storage?.setItem(key, bookmark(route))
    else storage?.removeItem(key)
    setCurrent(route)
  }
  function close(tab: ChatRoute) {
    setClosed((prev) => [...prev.filter((r) => identity(r) !== identity(tab)), tab].slice(-100))
    const remaining = tabs().filter((t) => t !== tab)
    setOpened((prev) => prev.filter((t) => t !== tab))
    if (current() === tab) {
      const next =
        [...visits]
          .reverse()
          .map((id) => remaining.find((r) => identity(r) === id))
          .find(Boolean) ?? remaining.at(-1)
      if (next) select(next)
      else leave()
    }
  }
  const leave = () => {
    restoreKey = undefined
    storage?.removeItem(key)
    setCurrent(undefined)
  }
  return {
    opened: (): readonly ChatRoute[] => opened(),
    tabs,
    closed() {
      const r = current()
      return r?.kind === "session" ? closed().filter((t) => group(t) === group(r)) : []
    },
    renamed(tab: ChatRoute, title: string) {
      const next = { ...tab, title }
      setOpened((prev) => prev.map((r) => (identity(r) === identity(tab) ? next : r)))
      if (current() === tab) select(next)
    },
    removed(tab: ChatRoute) {
      close(tab)
      setClosed((prev) => prev.filter((r) => identity(r) !== identity(tab)))
    },
    cancelDraft() {
      const previous = tabs().find((t) => identity(t) === recent.get(group(t)))
      if (previous) select(previous)
      else leave()
    },
    report,
    state,
    workspaceState(project: CloudProject, workspaceID: string) {
      const routes = opened().filter(
        (t) => t.directory === project.directory && t.scope === project.scope && t.target.workspaceID === workspaceID,
      )
      const form = current()
      return strongest([
        ...routes.map(state),
        form?.kind === "create" &&
        form.workspaceID === workspaceID &&
        form.directory === project.directory &&
        form.scope === project.scope
          ? state(form)
          : "idle",
      ])
    },
    close,
    current,
    restore(routes: ChatRoute[]) {
      const saved = routes.find((r) => restoreKey === bookmark(r) || restoreKey === identity(r))
      if (!saved) return false
      batch(() => {
        for (const r of routes) select(r)
        select(saved)
      })
      return true
    },
    workspace(routes: ChatRoute[]) {
      if (!routes.length) return
      const visible = routes.filter((r) => !closed().some((c) => identity(c) === identity(r)))
      const active = visible.find((r) => identity(r) === recent.get(group(r))) ?? visible[0] ?? routes[0]!
      batch(() => {
        for (const r of visible) select(r)
        select(active)
      })
    },
    select,
    leave,
    invalidate(directory?: string) {
      recent.clear()
      setClosed((prev) => prev.filter((t) => directory && t.directory !== directory))
      setOpened((prev) => prev.filter((t) => directory && t.directory !== directory))
      if (!directory || current()?.directory === directory) leave()
    },
    created(origin: CreateRoute, target: KiloHostedRpc.Target, title: string, initial?: HostedChoice) {
      // The workspace can finish provisioning after Back, a project change or an account change.
      if (current() !== origin || origin.scope !== target.scope) return false
      if (origin.workspaceID && origin.workspaceID !== target.workspaceID) return false
      select({ ...origin, kind: "session", target, title, initial })
      return true
    },
  }
}

export type CloudNavigation = ReturnType<typeof createCloudNavigation>
