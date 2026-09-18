import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js"
import type { PermissionRequest, WebviewMessage } from "../types/messages"

export function createPermissionResponses(
  opts: {
    permissions: Accessor<PermissionRequest[]>
    setPermissions: Setter<PermissionRequest[]>
    responding: Accessor<Set<string>>
    setResponding: Setter<Set<string>>
    terminal: (id: string, session: string) => boolean
    post: (message: WebviewMessage) => void
    expired: (id: string) => void
  },
  timeout = 55_000,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const clear = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  createEffect(() => {
    const active = new Set(opts.permissions().map((permission) => permission.id))
    for (const id of timers.keys()) {
      if (!active.has(id)) clear(id)
    }
  })
  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer)
  })

  function start(id: string) {
    opts.setResponding((prev) => new Set(prev).add(id))
    opts.setPermissions((prev) =>
      prev.map((permission) => (permission.id === id ? { ...permission, responseError: undefined } : permission)),
    )
    clear(id)
    // Missing completion only permits a read-only check, never another approval.
    timers.set(
      id,
      setTimeout(() => {
        clear(id)
        opts.expired(id)
      }, timeout),
    )
  }

  function respond(
    id: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
    feedback?: string,
  ) {
    const permission = opts.permissions().find((item) => item.id === id)
    if (
      !permission ||
      opts.terminal(id, permission.sessionID) ||
      opts.responding().has(id) ||
      permission.responseError === "unknown"
    )
      return false
    start(id)
    const message = feedback?.trim()
    opts.post({
      type: "permissionResponse",
      permissionId: id,
      sessionID: permission.sessionID,
      response,
      approvedAlways,
      deniedAlways,
      ...(message ? { feedback: message } : {}),
    })
    return true
  }

  function check(id: string) {
    const permission = opts.permissions().find((item) => item.id === id)
    if (!permission || opts.terminal(id, permission.sessionID) || opts.responding().has(id)) return
    start(id)
    opts.post({ type: "permissionStatus", permissionId: id, sessionID: permission.sessionID })
  }

  return { respond, check, clear }
}
