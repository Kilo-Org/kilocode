/**
 * Hosted session handlers — extracted from KiloProvider.
 *
 * Discovery, durable open, and start for hosted sessions. No vscode
 * dependency, and no direct provider transport: everything goes through the
 * local backend's session-host surface.
 */
import type { SessionHostStartInput } from "@kilocode/sdk/v2/client"
import type { HostedService, HostedStartInput, HostedTurn } from "../../hosted/service"
import { attachmentFailure } from "../../hosted/failure"
import { hostedKey } from "../../hosted/identity"

export interface HostedContext {
  readonly hosted: HostedService
  postMessage(msg: unknown): void
  /** Converts native turns into the webview transcript shape. */
  mapTurns(items: HostedTurn[]): unknown[]
  /** Starts live event delivery for a session that is already running. */
  watch?(key: string): void
}

function fail(ctx: HostedContext, error: unknown, sessionID?: string) {
  const failure = attachmentFailure(error)
  const message = failure?.message ?? (error instanceof Error ? error.message : "Hosted session request failed")
  ctx.postMessage({ type: "hostedSessionFailed", error: message, code: failure?.code, sessionID })
}

export async function handleHostedProviders(ctx: HostedContext): Promise<void> {
  try {
    const providers = await ctx.hosted.providers()
    ctx.postMessage({ type: "hostedProvidersLoaded", providers })
  } catch (error) {
    console.error("[Kilo New] Failed to read hosted providers:", error)
    ctx.postMessage({
      type: "hostedProvidersLoaded",
      providers: [],
      error: error instanceof Error ? error.message : "Hosted providers are unavailable",
    })
  }
}

export async function handleHostedSessions(ctx: HostedContext, limit?: number): Promise<void> {
  try {
    const sessions = await ctx.hosted.list(limit)
    ctx.postMessage({ type: "hostedSessionsLoaded", sessions })
  } catch (error) {
    console.error("[Kilo New] Failed to list hosted sessions:", error)
    ctx.postMessage({
      type: "hostedSessionsLoaded",
      sessions: [],
      error: error instanceof Error ? error.message : "Hosted sessions are unavailable",
    })
  }
}

/** Durable open: reads stored history without attaching or waking compute. */
export async function handleHostedOpen(
  ctx: HostedContext,
  providerID: string,
  sessionID: string,
  limit?: number,
): Promise<void> {
  try {
    const open = await ctx.hosted.open(providerID, sessionID, limit)
    ctx.postMessage({
      type: "hostedSessionLoaded",
      key: open.key,
      providerID,
      sessionID,
      session: open.session,
      title: open.session.title || "Hosted session",
      messages: ctx.mapTurns(open.items),
      cursor: open.cursor,
      omitted: open.omitted,
      mode: "replace",
    })
  } catch (error) {
    console.error("[Kilo New] Failed to open hosted session:", error)
    const key = hostedKey(providerID, sessionID)
    fail(ctx, error, key)
    ctx.postMessage({
      type: "error",
      sessionID: key,
      message:
        attachmentFailure(error)?.message ?? (error instanceof Error ? error.message : "Hosted session is unavailable"),
    })
  }
}

export async function handleHostedStart(ctx: HostedContext, input: HostedStartInput): Promise<void> {
  try {
    const start = await ctx.hosted.start(input)
    ctx.watch?.(start.key)
    ctx.postMessage({ type: "hostedSessionStarted", ...start })
  } catch (error) {
    console.error("[Kilo New] Failed to start hosted session:", error)
    fail(ctx, error)
  }
}

export async function handleHostedDetach(ctx: HostedContext, key: string): Promise<void> {
  try {
    await ctx.hosted.detach(key)
  } catch (error) {
    console.error("[Kilo New] Failed to detach hosted session:", error)
  }
  ctx.postMessage({ type: "hostedSessionDetached", key })
}

export function hostedRepository(input: {
  type?: string
  repo?: string
  url?: string
  branch?: string
}): SessionHostStartInput["repository"] | undefined {
  const branch = input.branch?.trim()
  const repo = input.repo?.trim()
  const url = input.url?.trim()
  if (input.type === "github" && repo) return { type: "github", repo, ...(branch ? { branch } : {}) }
  if (input.type === "gitlab" && url) return { type: "gitlab", url, ...(branch ? { branch } : {}) }
  if (input.type === "git" && url) return { type: "git", url, ...(branch ? { branch } : {}) }
  if (repo) return { type: "github", repo, ...(branch ? { branch } : {}) }
  if (url) return { type: "git", url, ...(branch ? { branch } : {}) }
  return
}
