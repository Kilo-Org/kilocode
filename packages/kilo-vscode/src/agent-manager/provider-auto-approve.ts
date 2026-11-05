// The host-side auto-approve sweep. The toggle is one persisted global state, and v1 replied to every permission
// request in the extension host (src/commands/toggle-auto-approve.ts on main). The webview only renders the toggle and
// persists it, so sessions in worktrees the panel is not showing are approved while it is closed too.
import type { OpenCodeClient, OpenCodeEvent, PermissionRequest } from "@opencode/client"

/** Cap on remembered request IDs, so a long-lived host does not grow the set forever. */
export const RESPONDED_LIMIT = 1000

/**
 * True when auto-approve should reply to this request. v1 replied once per request, only while active, and never
 * auto-approved sandbox-escalation prompts (packages/kilo-vscode/src/commands/toggle-auto-approve.ts on main). The v2
 * permission carries the escalation as its action, and the older metadata marker stays excluded too.
 */
export function shouldApprove(
  request: PermissionRequest,
  enabled: boolean,
  responded: ReadonlySet<string>,
): boolean {
  if (!enabled) return false
  if (responded.has(request.id)) return false
  if (request.action === "sandbox_escalation") return false
  return request.metadata?.["sandboxEscalation"] !== true
}

export type AutoApproveReply = (request: PermissionRequest) => Promise<unknown>

/**
 * Framework-free core of the auto-approve reaction. It dedupes requests across the event stream and the pending
 * sweep, so a request picked up by both triggers is still replied to once.
 */
export function createAutoApproveController(reply: AutoApproveReply) {
  const responded = new Set<string>()
  let enabled = false

  const approve = (request: PermissionRequest) => {
    if (!shouldApprove(request, enabled, responded)) return
    responded.add(request.id)
    for (const oldest of responded) {
      if (responded.size <= RESPONDED_LIMIT) break
      responded.delete(oldest)
    }
    // A failed reply leaves the request pending, so allow a later sweep to retry it.
    void reply(request).catch(() => responded.delete(request.id))
  }

  return {
    setEnabled(value: boolean) {
      enabled = value
    },
    /** Approve a batch: a permission event or the result of the pending sweep. */
    approve(requests: Iterable<PermissionRequest>) {
      for (const request of requests) approve(request)
    },
  }
}

/**
 * The auto-approve state the host sweep reads. `src/chat.ts` records it, because it owns the persisted flag and the
 * webview messages that change it.
 */
export type HostAutoApproveState = {
  /** The persisted toggle. Read at each decision, so a change applies without restarting the sweep. */
  enabled: () => boolean
  /** The directory the sidebar works in, which may not be the checkout root the panel uses. */
  directory: string
}

let hostState: HostAutoApproveState | undefined
const listeners = new Set<() => void>()

/** Records the state the host sweep reads. Called once at activation, from the sidebar host. */
export function setHostAutoApprove(state: HostAutoApproveState) {
  hostState = state
}

/** Notifies the sweep that a view persisted a new value, so requests that are already pending are approved. */
export function notifyHostAutoApprove() {
  listeners.forEach((listener) => listener())
}

export function onHostAutoApproveChange(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/**
 * Replies to permission requests while the persisted toggle is on. `event` handles requests as they arrive, and `sweep`
 * approves the ones that were already pending, for example when the extension starts or the toggle is switched on.
 */
export function createHostAutoApprove(input: {
  client: () => Promise<OpenCodeClient>
  /** The project roots and worktree paths of the Agent Manager. The sidebar directory is added from the shared state. */
  directories: () => readonly string[]
  log: (message: string) => void
}) {
  const controller = createAutoApproveController((request) =>
    input.client().then((api) =>
      api.permission.reply({ sessionID: request.sessionID, requestID: request.id, decision: "once" }),
    ),
  )

  const enabled = () => hostState?.enabled() ?? false
  // The controller caches the flag, and a reset can change it without a notification, so sync before every decision.
  const sync = () => controller.setEnabled(enabled())

  const event = (event: OpenCodeEvent) => {
    if (event.type !== "permission.asked") return
    sync()
    controller.approve([event.data])
  }

  const sweep = () => {
    sync()
    if (!enabled()) return
    const directories = new Set([...(hostState ? [hostState.directory] : []), ...input.directories()])
    void input
      .client()
      .then(async (api) => {
        const lists = await Promise.all(
          [...directories].map((directory) =>
            api.permission.request.list({ location: { directory } }).catch(() => undefined),
          ),
        )
        for (const list of lists) if (list) controller.approve(list.data)
      })
      .catch((error: unknown) => input.log(`Auto-approve sweep failed: ${String(error)}`))
  }

  return { event, sweep }
}
