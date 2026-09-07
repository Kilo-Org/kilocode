/**
 * Permission handlers — extracted from KiloProvider.
 *
 * Manages permission responses (once/always/reject) and recovery of
 * pending permissions after SSE reconnections. No vscode dependency.
 */

import type { KiloClient, PermissionRequest } from "@kilocode/sdk/v2/client"
import { isNotFoundError } from "./not-found"

export type RecoverablePermission = PermissionRequest

export interface PermissionContext {
  readonly client: KiloClient | null
  readonly currentSessionId: string | undefined
  readonly trackedSessionIds: Set<string>
  readonly sessionDirectories: ReadonlyMap<string, string>
  readonly extraDirectories?: () => string[]
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
  recordPermissionDirectory(requestID: string, directory: string): void
  getPermissionDirectory(requestID: string): string | undefined
  clearPermissionDirectory(requestID: string): void
  getPermissionRevision(): number
  prunePermissionDirectories(active: Set<string>, dirs?: Set<string>): void
}

export function recoveryDirs(workspace: string, dirs: ReadonlyMap<string, string>, extra: string[] = []) {
  return [...new Set([workspace, ...dirs.values(), ...extra])]
}

export function recoverablePermissions(perms: RecoverablePermission[], tracked: Set<string>, seen: Set<string>) {
  return perms.filter((perm) => {
    if (seen.has(perm.id)) return false
    seen.add(perm.id)
    return tracked.has(perm.sessionID)
  })
}

/**
 * Handle permission response from the webview.
 * Calls saveAlwaysRules first (if any), then reply — sequentially to avoid races.
 */
export async function handlePermissionResponse(
  ctx: PermissionContext,
  permissionId: string,
  sessionID: string,
  response: "once" | "always" | "reject",
  approvedAlways: string[],
  deniedAlways: string[],
): Promise<void> {
  if (!ctx.client) {
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
    return
  }

  const target = sessionID || ctx.currentSessionId
  if (!target) {
    console.error("[Kilo New] KiloProvider: No sessionID for permission response")
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
    return
  }

  const dir = ctx.getPermissionDirectory(permissionId) ?? ctx.getWorkspaceDirectory(target)

  const staleCleanup = () => {
    ctx.clearPermissionDirectory(permissionId)
    ctx.postMessage({ type: "permissionError", permissionID: permissionId, stale: true })
    void fetchAndSendPendingPermissions(ctx)
  }

  if (approvedAlways.length > 0 || deniedAlways.length > 0) {
    const saveResult = await ctx.client.permission
      .saveAlwaysRules(
        {
          requestID: permissionId,
          directory: dir,
          approvedAlways,
          deniedAlways,
        },
        { throwOnError: true },
      )
      .then(() => "ok" as const)
      .catch((error: unknown) => {
        if (isNotFoundError(error)) return "stale" as const
        console.error("[Kilo New] KiloProvider: Failed to save always-rules:", error)
        ctx.postMessage({ type: "permissionError", permissionID: permissionId })
        return "error" as const
      })
    if (saveResult === "stale") {
      staleCleanup()
      return
    }
    if (saveResult === "error") return
  }

  const replyResult = await ctx.client.permission
    .reply({ requestID: permissionId, reply: response, directory: dir, interactive: true }, { throwOnError: true })
    .then(() => "ok" as const)
    .catch((error: unknown) => {
      if (isNotFoundError(error)) return "stale" as const
      console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
      ctx.postMessage({ type: "permissionError", permissionID: permissionId })
      return "error" as const
    })
  if (replyResult === "stale") staleCleanup()
  if (replyResult !== "ok") return
  ctx.clearPermissionDirectory(permissionId)
  ctx.postMessage({ type: "permissionResolved", permissionID: permissionId, sessionID: target, response })
}

/**
 * Fetch all pending permissions from the backend and forward any that belong
 * to tracked sessions to the webview. Called after SSE reconnects and after
 * loading messages for a session so that missed permission.asked events are
 * recovered instead of leaving the server blocked indefinitely.
 */
export async function fetchAndSendPendingPermissions(ctx: PermissionContext): Promise<void> {
  if (!ctx.client) return
  try {
    const dirs = recoveryDirs(ctx.getWorkspaceDirectory(), ctx.sessionDirectories, ctx.extraDirectories?.() ?? [])

    for (;;) {
      const revision = ctx.getPermissionRevision()
      const seen = new Set<string>()
      const valid = new Set<string>()
      const pending: Array<{ perm: RecoverablePermission; dir: string }> = []
      for (const dir of dirs) {
        const { data, error } = await ctx.client.permission.list({ directory: dir })
        if (error) {
          console.error(`[Kilo New] KiloProvider: Failed to fetch pending permissions for ${dir}:`, error)
          continue
        }
        valid.add(dir)
        if (!data) continue
        for (const perm of recoverablePermissions(data, ctx.trackedSessionIds, seen)) pending.push({ perm, dir })
      }
      if (ctx.getPermissionRevision() !== revision) continue
      for (const { perm, dir } of pending) {
        ctx.recordPermissionDirectory(perm.id, dir)
        ctx.postMessage({
          type: "permissionRequest",
          permission: {
            id: perm.id,
            sessionID: perm.sessionID,
            toolName: perm.permission,
            patterns: perm.patterns,
            always: perm.always,
            args: perm.metadata,
            message: `Permission required: ${perm.permission}`,
            tool: perm.tool,
          },
        })
      }
      ctx.prunePermissionDirectories(seen, valid)
      return
    }
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch pending permissions:", error)
  }
}
