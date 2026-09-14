/**
 * Permission handlers — extracted from KiloProvider.
 *
 * Manages permission responses (once/always/reject) and recovery of
 * pending permissions after SSE reconnections. No vscode dependency.
 */

import type { KiloClient, PermissionRequest } from "@kilocode/sdk/v2/client"
import { isNotFoundError } from "./not-found"

export type RecoverablePermission = PermissionRequest
export type PermissionResponse = "once" | "always" | "reject"
export type PermissionResponseResult =
  | { kind: "resolved"; sessionID: string; response: PermissionResponse }
  | { kind: "stale" }
  | { kind: "error" }

export interface PermissionContext {
  readonly client: KiloClient | null
  readonly currentSessionId: string | undefined
  readonly trackedSessionIds: Set<string>
  readonly sessionDirectories: ReadonlyMap<string, string>
  readonly extraDirectories?: () => string[]
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
  recordPermissionDirectory(requestID: string, directory: string, sessionID?: string): void
  getPermissionDirectory(requestID: string): string | undefined
  getPermissionSession?(requestID: string): string | undefined
  clearPermissionDirectory(requestID: string): void
  getPermissionRevision(): number
  prunePermissionDirectories(active: Set<string>, dirs?: Set<string>): void
  runPermissionResponse?: (
    requestID: string,
    sessionID: string,
    action: () => Promise<PermissionResponseResult>,
  ) => Promise<PermissionResponseResult>
  isPermissionResponseClaimed?: (requestID: string) => boolean
  clearPermissionResponse?: (requestID: string) => void
}

export function recoveryDirs(workspace: string, dirs: ReadonlyMap<string, string>, extra: string[] = []) {
  return [...new Set([workspace, ...dirs.values(), ...extra])]
}

export function recoverablePermissions(
  perms: RecoverablePermission[],
  tracked: Set<string>,
  seen: Set<string>,
  claimed: (requestID: string) => boolean = () => false,
) {
  return perms.filter((perm) => {
    if (seen.has(perm.id)) return false
    seen.add(perm.id)
    if (claimed(perm.id)) return false
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
  response: PermissionResponse,
  approvedAlways: string[],
  deniedAlways: string[],
  feedback?: string,
): Promise<void> {
  const client = ctx.client
  if (!client) {
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
    return
  }

  const dir = ctx.getPermissionDirectory(permissionId)
  const target = ctx.getPermissionSession?.(permissionId) ?? sessionID
  const claimed = ctx.isPermissionResponseClaimed?.(permissionId) ?? false
  if (!target || (!dir && !claimed) || (ctx.getPermissionSession?.(permissionId) && target !== sessionID)) {
    console.error("[Kilo New] KiloProvider: Unknown permission route")
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
    return
  }

  const run =
    ctx.runPermissionResponse ??
    ((_requestID: string, _sessionID: string, action: () => Promise<PermissionResponseResult>) => action())
  const action = async (): Promise<PermissionResponseResult> => {
    if (!dir) return { kind: "error" }

    if (approvedAlways.length > 0 || deniedAlways.length > 0) {
      const saveResult = await client.permission
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
          return "error" as const
        })
      if (saveResult === "stale") {
        ctx.clearPermissionDirectory(permissionId)
        void fetchAndSendPendingPermissions(ctx)
        return { kind: "stale" }
      }
      if (saveResult === "error") return { kind: "error" }
    }

    const replyResult = await client.permission
      .reply(
        {
          requestID: permissionId,
          reply: response,
          directory: dir,
          interactive: true,
          ...(feedback ? { message: feedback } : {}),
        },
        { throwOnError: true },
      )
      .then(() => "ok" as const)
      .catch((error: unknown) => {
        if (isNotFoundError(error)) return "stale" as const
        console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
        return "error" as const
      })
    if (replyResult === "stale") {
      ctx.clearPermissionDirectory(permissionId)
      void fetchAndSendPendingPermissions(ctx)
      return { kind: "stale" }
    }
    if (replyResult !== "ok") return { kind: "error" }
    ctx.clearPermissionDirectory(permissionId)
    return { kind: "resolved", sessionID: target, response }
  }

  const result = await run(permissionId, target, action).catch((error: unknown) => {
    console.error("[Kilo New] KiloProvider: Failed to process permission response:", error)
    return { kind: "error" } as const
  })
  if (result.kind === "error") {
    ctx.clearPermissionResponse?.(permissionId)
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
    return
  }
  if (result.kind === "stale") {
    ctx.postMessage({ type: "permissionError", permissionID: permissionId, stale: true })
    return
  }
  ctx.postMessage({
    type: "permissionResolved",
    permissionID: permissionId,
    sessionID: result.sessionID,
    response: result.response,
  })
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
        for (const perm of recoverablePermissions(
          data,
          ctx.trackedSessionIds,
          seen,
          (id) => ctx.isPermissionResponseClaimed?.(id) ?? false,
        ))
          pending.push({ perm, dir })
      }
      if (ctx.getPermissionRevision() !== revision) continue
      for (const { perm, dir } of pending) {
        ctx.recordPermissionDirectory(perm.id, dir, perm.sessionID)
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
