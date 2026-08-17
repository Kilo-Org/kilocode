import {
  consumeManagedBatch,
  enqueueManaged,
  FOUNDATION_EVENT,
  FOUNDATION_WAKE_TYPES,
  FileBackedSessionMessenger,
  mapKiloRuntimeStatus,
  recordCoordinatorWake,
  recordResume,
  resumeDecision,
  shouldWakeCoordinator,
  unconsumedManaged,
  type ManagedEvent,
  createGenericTelemetry,
} from "@kilocode/kilo-foundation"

export type DeliveryResult = "sent" | "queued" | "rejected"

export interface QueuedPrompt {
  sessionId: string
  directory: string
  text: string
}

/** Fields Agent Manager actually forwards into `session.promptAsync`. */
export type PromptAsyncExtra = {
  model?: { providerID: string; modelID: string }
  variant?: string
  snapshotInitialization?: "wait"
  noReply?: boolean
  messageID?: string
  synthetic?: boolean
}

type PromptAsyncParameters = {
  sessionID: string
  directory?: string
  parts: Array<{ type: "text"; text: string; synthetic?: boolean }>
} & Omit<PromptAsyncExtra, "synthetic">

/**
 * Duck-typed session client. Parameter fields must be assignable to the generated
 * Kilo SDK `promptAsync` body (`model` cannot be `unknown`).
 */
type PromptClient = {
  session: {
    status?(input: { directory: string }): Promise<{ data?: Record<string, { type?: string }> }>
    promptAsync(parameters: PromptAsyncParameters, opts?: { throwOnError?: boolean }): Promise<unknown>
  }
}

function eventKey(event: ManagedEvent): string {
  return `${event.sessionId ?? ""}:${event.type}:${String(event.payload.text ?? event.payload.kind ?? event.id)}`
}

function promptBody(sessionId: string, directory: string, text: string, extra?: PromptAsyncExtra): PromptAsyncParameters {
  const { synthetic, ...rest } = extra ?? {}
  return {
    sessionID: sessionId,
    directory,
    parts: [{ type: "text", text, ...(synthetic ? { synthetic: true } : {}) }],
    ...rest,
  }
}

/**
 * Managed inbox for Agent Manager. Queues prompts while a session is
 * mid-generation, persists them on disk, and flushes when resume is safe.
 */
export class ManagedSessionInbox {
  readonly events: ManagedEvent[] = []
  readonly telemetry = createGenericTelemetry()
  private messenger: FileBackedSessionMessenger | undefined

  attachPersistence(inboxRoot: string): void {
    this.messenger = new FileBackedSessionMessenger(inboxRoot)
  }

  detachPersistence(): void {
    this.messenger = undefined
  }

  async enqueuePrompt(input: QueuedPrompt, nowIso = new Date().toISOString(), persist = true): Promise<void> {
    enqueueManaged(
      this.events,
      {
        id: `${input.sessionId}:${nowIso}:${this.events.length}`,
        type: FOUNDATION_EVENT.MESSAGE_RECEIVED,
        sessionId: input.sessionId,
        payload: { text: input.text, directory: input.directory, kind: "message" },
        createdAt: nowIso,
      },
      eventKey,
    )
    if (persist) await this.messenger?.sendQueued(input.sessionId, input.text, input.directory)
  }

  enqueueFoundationEvent(
    type: typeof FOUNDATION_EVENT.STALLED | typeof FOUNDATION_EVENT.RESUMABLE | typeof FOUNDATION_EVENT.STATUS_CHANGED,
    sessionId: string,
    payload: Record<string, unknown> = {},
    nowIso = new Date().toISOString(),
  ): void {
    enqueueManaged(
      this.events,
      {
        id: `${sessionId}:${type}:${nowIso}`,
        type,
        sessionId,
        payload,
        createdAt: nowIso,
      },
      eventKey,
    )
  }

  peekForSession(sessionId: string): QueuedPrompt | undefined {
    const pending = unconsumedManaged(this.events).find((event) => event.sessionId === sessionId)
    const text = typeof pending?.payload.text === "string" ? pending.payload.text : undefined
    const directory = typeof pending?.payload.directory === "string" ? pending.payload.directory : undefined
    if (!pending || !text || !directory) return undefined
    return { sessionId, directory, text }
  }

  async takeForSession(sessionId: string, nowIso = new Date().toISOString()): Promise<QueuedPrompt[]> {
    const pending = this.events.filter((event) => event.sessionId === sessionId && event.consumedAt === undefined)
    const batch = consumeManagedBatch(pending, 10, nowIso)
    if (batch.length > 0 && shouldWakeCoordinator(FOUNDATION_EVENT.MESSAGE_RECEIVED, FOUNDATION_WAKE_TYPES)) {
      recordCoordinatorWake(this.telemetry, batch.length)
    }
    if (batch.length > 0) await this.messenger?.consumePending(sessionId, batch.length)
    return batch.flatMap((event) => {
      const text = typeof event.payload.text === "string" ? event.payload.text : undefined
      const directory = typeof event.payload.directory === "string" ? event.payload.directory : undefined
      if (!text || !directory) return []
      return [{ sessionId, directory, text }]
    })
  }

  async hydrate(): Promise<string[]> {
    if (!this.messenger) return []
    const sessions = await this.messenger.listSessions()
    const ids: string[] = []
    for (const sessionId of sessions) {
      const pending = await this.messenger.listPending(sessionId)
      let added = false
      for (const envelope of pending) {
        if (envelope.kind !== "message" || !envelope.message || !envelope.directory) continue
        await this.enqueuePrompt(
          { sessionId, directory: envelope.directory, text: envelope.message },
          envelope.createdAt,
          false,
        )
        added = true
      }
      if (added) ids.push(sessionId)
    }
    return ids
  }
}

export const managedInbox = new ManagedSessionInbox()

export async function runtimeStatus(client: PromptClient, directory: string, sessionId: string): Promise<string> {
  try {
    const result = await client.session.status?.({ directory })
    return result?.data?.[sessionId]?.type ?? "idle"
  } catch {
    return "idle"
  }
}

/** Queue a follow-up Agent Manager text send when the session is already busy. */
export function queueBusyAgentSend(input: {
  busy: boolean
  sessionId?: string
  directory?: string
  text?: string
  fileCount?: number
}): DeliveryResult | "pass" {
  if (!input.busy || (input.fileCount ?? 0) > 0) return "pass"
  const text = input.text?.trim()
  if (!input.sessionId || !input.directory || !text) return "pass"
  void managedInbox.enqueuePrompt({ sessionId: input.sessionId, directory: input.directory, text })
  return "queued"
}

export async function promptWhenSafe(
  client: PromptClient,
  input: {
    sessionId: string
    directory: string
    text: string
    extra?: PromptAsyncExtra
  },
): Promise<DeliveryResult> {
  const lifecycle = mapKiloRuntimeStatus(await runtimeStatus(client, input.directory, input.sessionId))
  const decision = resumeDecision(lifecycle)
  if (decision === "wait") {
    await managedInbox.enqueuePrompt({ sessionId: input.sessionId, directory: input.directory, text: input.text })
    return "queued"
  }
  if (decision === "fail") {
    return "rejected"
  }
  await client.session.promptAsync(promptBody(input.sessionId, input.directory, input.text, input.extra), {
    throwOnError: true,
  })
  return "sent"
}

export async function flushIdleSession(
  client: PromptClient,
  sessionId: string,
  extra?: PromptAsyncExtra,
  force = false,
): Promise<number> {
  const peek = managedInbox.peekForSession(sessionId)
  if (!peek) return 0
  if (!force) {
    const decision = resumeDecision(mapKiloRuntimeStatus(await runtimeStatus(client, peek.directory, sessionId)))
    if (decision !== "resume") return 0
  }
  const queued = await managedInbox.takeForSession(sessionId)
  for (const item of queued) {
    await client.session.promptAsync(promptBody(item.sessionId, item.directory, item.text, extra), {
      throwOnError: true,
    })
  }
  return queued.length
}

export async function resumeQueuedSessions(client: PromptClient, extra?: PromptAsyncExtra): Promise<number> {
  const sessionIds = await managedInbox.hydrate()
  let sent = 0
  for (const sessionId of sessionIds) {
    const n = await flushIdleSession(client, sessionId, extra)
    if (n > 0) {
      recordResume(managedInbox.telemetry)
      sent += n
    }
  }
  return sent
}
