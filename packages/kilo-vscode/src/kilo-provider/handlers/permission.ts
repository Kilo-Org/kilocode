/**
 * Permission handlers — extracted from KiloProvider.
 *
 * Manages permission responses (once/always/reject) and recovery of
 * pending permissions after SSE reconnections. No vscode dependency.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"

export interface PermissionContext {
  readonly client: KiloClient | null
  readonly currentSessionId: string | undefined
  readonly trackedSessionIds: Set<string>
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
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

  try {
    const dir = ctx.getWorkspaceDirectory(target)

    // Save per-pattern rules before replying (reply deletes the pending request)
    if (approvedAlways.length > 0 || deniedAlways.length > 0) {
      await ctx.client.permission.saveAlwaysRules(
        {
          requestID: permissionId,
          directory: dir,
          approvedAlways,
          deniedAlways,
        },
        { throwOnError: true },
      )
    }

    await ctx.client.permission.reply(
      { requestID: permissionId, reply: response, directory: dir },
      { throwOnError: true },
    )
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
    ctx.postMessage({ type: "permissionError", permissionID: permissionId })
  }
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
    const dir = ctx.getWorkspaceDirectory()
    const { data } = await ctx.client.permission.list({ directory: dir })
    if (!data) return
    for (const perm of data) {
      if (!ctx.trackedSessionIds.has(perm.sessionID)) continue
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
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch pending permissions:", error)
  }
}
