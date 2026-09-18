/**
 * Permission handlers — extracted from KiloProvider.
 *
 * Manages permission responses (once/always/reject) and recovery of
 * pending permissions after SSE reconnections. No vscode dependency.
 */

import type { KiloClient, PermissionRequest } from "@kilocode/sdk/v2/client"
import { permissionStatus, respondToPermission } from "@kilocode/sdk/permission"
import { isNotFoundError } from "./not-found"

export type RecoverablePermission = PermissionRequest
export type PermissionResponse = "once" | "always" | "reject"
export type PermissionResponseResult =
  | { kind: "resolved"; sessionID: string; response: PermissionResponse }
  | { kind: "stale" }
  | { kind: "error"; retryable?: boolean }

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
    ctx.recordPermissionDirectory(permissionId, dir, target)

    const result = await respondToPermission(client, {
      requestID: permissionId,
      sessionID: target,
      directory: dir,
      reply: response,
      approvedAlways,
      deniedAlways,
      message: feedback,
    })
    if (result.status === "missing" || isNotFoundError(result.error)) {
      ctx.clearPermissionDirectory(permissionId)
      void fetchAndSendPendingPermissions(ctx)
      return { kind: "stale" }
    }
    if (result.status === "unknown") return { kind: "error", retryable: false }
    if (result.status === "pending") return { kind: "error" }
    ctx.clearPermissionDirectory(permissionId)
    return { kind: "resolved", sessionID: target, response }
  }

  const result = await run(permissionId, target, action).catch((error: unknown): PermissionResponseResult => {
    console.error("[Kilo New] KiloProvider: Failed to process permission response:", error)
    return { kind: "error", retryable: false }
  })
  if (result.kind === "error") {
    ctx.clearPermissionResponse?.(permissionId)
    ctx.postMessage({
      type: "permissionError",
      permissionID: permissionId,
      ...(result.retryable === false ? { retryable: false } : {}),
    })
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

/** Reuse an in-flight response claim, but never submit a new decision to check status. */
export async function handlePermissionStatus(
  ctx: PermissionContext,
  permissionId: string,
  sessionID: string,
): Promise<void> {
  const dir = ctx.getPermissionDirectory(permissionId)
  const target = ctx.getPermissionSession?.(permissionId) ?? sessionID
  if (!ctx.client || (!dir && !ctx.isPermissionResponseClaimed?.(permissionId)) || target !== sessionID) {
    ctx.postMessage({ type: "permissionError", permissionID: permissionId, retryable: false })
    return
  }
  const client = ctx.client
  const action = async (): Promise<PermissionResponseResult> => {
    if (!dir) return { kind: "error", retryable: false }
    ctx.recordPermissionDirectory(permissionId, dir, target)
    const status = await permissionStatus(client, { requestID: permissionId, sessionID: target, directory: dir })
    if (status === "missing") {
      ctx.clearPermissionDirectory(permissionId)
      return { kind: "stale" }
    }
    return { kind: "error", retryable: status === "pending" }
  }
  const result = await (ctx.runPermissionResponse?.(permissionId, target, action) ?? action())
  if (result.kind === "resolved") {
    ctx.postMessage({
      type: "permissionResolved",
      permissionID: permissionId,
      sessionID: result.sessionID,
      response: result.response,
    })
    return
  }
  ctx.postMessage({
    type: "permissionError",
    permissionID: permissionId,
    ...(result.kind === "stale" ? { stale: true } : { retryable: result.retryable !== false }),
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
