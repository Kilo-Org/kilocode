/**
 * Cloud session handlers — extracted from KiloProvider.
 *
 * Manages fetching cloud sessions, previewing them, and the "import + send"
 * flow that clones a cloud session locally on first message. No vscode dependency.
 */

import type { KiloClient, Session, TextPartInput, FilePartInput } from "@kilocode/sdk/v2/client"
import type { CloudSessionData, EditorContext } from "../../services/cli-backend/types"
import { getErrorMessage, sessionToWebview, mapCloudSessionMessageToWebviewMessage } from "../../kilo-provider-utils"
import type { MessageFile } from "../message-files"

export interface CloudSessionContext {
  readonly client: KiloClient | null
  currentSession: Session | null
  readonly trackedSessionIds: Set<string>
  readonly connectionService: {
    recordMessageSessionId(messageId: string, sessionId: string): void
  }
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
  gatherEditorContext(): Promise<EditorContext>
  runWithMessageConfirmation?<T>(
    messageID: string | undefined,
    label: string,
    run: () => Promise<T>,
  ): Promise<T | undefined>
}

/** Fetch cloud sessions list and send to webview. */
export async function handleRequestCloudSessions(
  ctx: CloudSessionContext,
  message: { cursor?: string; limit?: number; gitUrl?: string },
): Promise<void> {
  if (!ctx.client) {
    ctx.postMessage({ type: "error", message: "Not connected to CLI backend" })
    return
  }

  try {
    const result = await ctx.client.kilo.cloudSessions({
      cursor: message.cursor,
      limit: message.limit,
      gitUrl: message.gitUrl,
    })

    ctx.postMessage({
      type: "cloudSessionsLoaded",
      sessions: result.data?.cliSessions ?? [],
      nextCursor: result.data?.nextCursor ?? null,
    })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch cloud sessions:", error)
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Failed to fetch cloud sessions",
    })
  }
}

/**
 * Fetch full cloud session data for read-only preview.
 * Transforms the export data into webview message format and sends it back.
 */
export async function handleRequestCloudSessionData(ctx: CloudSessionContext, sessionId: string): Promise<void> {
  if (!ctx.client) {
    ctx.postMessage({
      type: "cloudSessionImportFailed",
      cloudSessionId: sessionId,
      error: "Not connected to CLI backend",
    })
    return
  }

  try {
    const result = await ctx.client.kilo.cloud.session.get({ id: sessionId })
    const data = result.data as CloudSessionData | undefined
    if (!data) {
      ctx.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId: sessionId,
        error: "Failed to fetch cloud session",
      })
      return
    }

    const messages = (data.messages ?? []).filter((m) => m.info).map(mapCloudSessionMessageToWebviewMessage)

    ctx.postMessage({
      type: "cloudSessionDataLoaded",
      cloudSessionId: sessionId,
      title: data.info.title ?? "Untitled",
      messages,
    })
  } catch (err) {
    console.error("[Kilo New] Failed to load cloud session data:", err)
    ctx.postMessage({
      type: "cloudSessionImportFailed",
      cloudSessionId: sessionId,
      error: err instanceof Error ? err.message : "Failed to load cloud session",
    })
  }
}

/**
 * Import a cloud session to local storage, then send a new message on it.
 * This is the "clone on first message" flow — the cloud session becomes a
 * local session only when the user decides to continue it.
 */
export async function handleImportAndSend(
  ctx: CloudSessionContext,
  cloudSessionId: string,
  text: string,
  messageID?: string,
  providerID?: string,
  modelID?: string,
  agent?: string,
  variant?: string,
  files?: MessageFile[],
  command?: string,
  commandArgs?: string,
): Promise<void> {
  if (!ctx.client) {
    ctx.postMessage({
      type: "cloudSessionImportFailed",
      cloudSessionId,
      error: "Not connected to CLI backend",
    })
    return
  }

  const client = ctx.client
  const dir = ctx.getWorkspaceDirectory()

  // Step 1: Import the cloud session with fresh IDs
  let session: Session | undefined
  try {
    const result = await ctx.client.kilo.cloud.session.import({
      sessionId: cloudSessionId,
      directory: dir,
    })
    session = result.data as Session | undefined
  } catch (error) {
    console.error("[Kilo New] KiloProvider: ❌ Cloud session import failed:", error)
    ctx.postMessage({
      type: "cloudSessionImportFailed",
      cloudSessionId,
      error: getErrorMessage(error) || "Failed to import session from cloud",
    })
    return
  }
  if (!session) {
    ctx.postMessage({
      type: "cloudSessionImportFailed",
      cloudSessionId,
      error: "Failed to import session from cloud",
    })
    return
  }

  // Track the new local session
  ctx.currentSession = session
  ctx.trackedSessionIds.add(session.id)

  // Notify webview of the import success
  ctx.postMessage({
    type: "cloudSessionImported",
    cloudSessionId,
    session: sessionToWebview(session),
  })

  // Step 2: Send the user's message/command on the new local session
  const run = ctx.runWithMessageConfirmation ?? ((_id, _label, fn) => fn())
  try {
    await run(messageID, "Cloud import send", async () => {
      if (messageID) {
        ctx.connectionService.recordMessageSessionId(messageID, session.id)
      }

      if (command) {
        const parts = files?.map((f) => ({
          type: "file" as const,
          mime: f.mime,
          url: f.url,
          filename: f.filename,
          source: f.source,
        }))
        await client.session.command(
          {
            sessionID: session.id,
            directory: dir,
            command,
            arguments: commandArgs ?? "",
            messageID,
            model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
            agent,
            variant,
            parts,
          },
          { throwOnError: true },
        )
        return
      }

      const parts: Array<TextPartInput | FilePartInput> = []
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url, filename: f.filename, source: f.source })
        }
      }
      parts.push({ type: "text", text })

      const editorContext = await ctx.gatherEditorContext()
      await client.session.promptAsync(
        {
          sessionID: session.id,
          directory: dir,
          messageID,
          parts,
          model: providerID && modelID ? { providerID, modelID } : undefined,
          agent,
          variant,
          editorContext,
        },
        { throwOnError: true },
      )
    })
  } catch (err) {
    console.error("[Kilo New] Failed to send message after cloud import:", err)
    ctx.postMessage({
      type: "sendMessageFailed",
      error: err instanceof Error ? err.message : "Failed to send message after import",
      text,
      sessionID: session.id,
      draftID: session.id,
      messageID,
      files,
    })
  }
}
