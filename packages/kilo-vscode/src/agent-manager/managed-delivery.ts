import {
  compactConsumed,
  enqueueManaged,
  forgetManagedSession,
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
  extra?: PromptAsyncExtra
  createdAt?: string
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

function isMessagePrompt(event: ManagedEvent): boolean {
  return event.type === FOUNDATION_EVENT.MESSAGE_RECEIVED && event.payload.kind === "message"
}

function extraFromUnknown(value: unknown): PromptAsyncExtra | undefined {
  if (!value || typeof value !== "object") return undefined
  const rec = value as Record<string, unknown>
  const extra: PromptAsyncExtra = {}
  if (typeof rec.messageID === "string") extra.messageID = rec.messageID
  if (typeof rec.variant === "string") extra.variant = rec.variant
  if (rec.noReply === true) extra.noReply = true
  if (rec.synthetic === true) extra.synthetic = true
  if (rec.snapshotInitialization === "wait") extra.snapshotInitialization = "wait"
  if (rec.model && typeof rec.model === "object") {
    const model = rec.model as Record<string, unknown>
    if (typeof model.providerID === "string" && typeof model.modelID === "string") {
      extra.model = { providerID: model.providerID, modelID: model.modelID }
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined
}

function cloneExtra(extra?: PromptAsyncExtra): PromptAsyncExtra | undefined {
  if (!extra) return undefined
  return extraFromUnknown(JSON.parse(JSON.stringify(extra)))
}

function promptFromEvent(event: ManagedEvent): QueuedPrompt | undefined {
  const text = typeof event.payload.text === "string" ? event.payload.text : undefined
  const directory = typeof event.payload.directory === "string" ? event.payload.directory : undefined
  if (!event.sessionId || !text || !directory || !isMessagePrompt(event)) return undefined
  return {
    sessionId: event.sessionId,
    directory,
    text,
    extra: extraFromUnknown(event.payload.extra),
    createdAt: event.createdAt,
  }
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

function persistExtra(extra?: PromptAsyncExtra): Record<string, unknown> | undefined {
  const cloned = cloneExtra(extra)
  return cloned as Record<string, unknown> | undefined
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
    const extra = cloneExtra(input.extra)
    enqueueManaged(
      this.events,
      {
        id: `${input.sessionId}:${nowIso}:${this.events.length}`,
        type: FOUNDATION_EVENT.MESSAGE_RECEIVED,
        sessionId: input.sessionId,
        payload: { text: input.text, directory: input.directory, kind: "message", extra },
        createdAt: nowIso,
      },
      eventKey,
    )
    if (!persist) return
    try {
      await this.messenger?.sendQueued(input.sessionId, input.text, input.directory, persistExtra(extra), nowIso)
    } catch (error) {
      console.warn("[kilo-foundation] managed inbox persist failed", error)
    }
  }

  enqueueFoundationEvent(
    type: typeof FOUNDATION_EVENT.STALLED | typeof FOUNDATION_EVENT.RESUMABLE | typeof FOUNDATION_EVENT.STATUS_CHANGED,
    sessionId: string,
    payload: Record<string, unknown> = {},
    nowIso = new Date().toISOString(),
  ): void {
    for (const event of this.events) {
      if (event.sessionId === sessionId && event.type === type && event.consumedAt === undefined) {
        event.consumedAt = nowIso
      }
    }
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
    this.compact()
  }

  peekForSession(sessionId: string): QueuedPrompt | undefined {
    const pending = unconsumedManaged(this.events).find((event) => event.sessionId === sessionId && isMessagePrompt(event))
    return pending ? promptFromEvent(pending) : undefined
  }

  pendingSessionIds(): string[] {
    const ids = new Set<string>()
    for (const event of unconsumedManaged(this.events)) {
      if (event.sessionId && isMessagePrompt(event)) ids.add(event.sessionId)
    }
    return [...ids]
  }

  async acknowledgeSent(prompt: QueuedPrompt, nowIso = new Date().toISOString()): Promise<void> {
    const event = unconsumedManaged(this.events).find((item) => {
      const queued = promptFromEvent(item)
      return (
        queued?.sessionId === prompt.sessionId &&
        queued.text === prompt.text &&
        queued.directory === prompt.directory &&
        (!prompt.createdAt || queued.createdAt === prompt.createdAt)
      )
    })
    if (event) {
      event.consumedAt = nowIso
      if (shouldWakeCoordinator(FOUNDATION_EVENT.MESSAGE_RECEIVED, FOUNDATION_WAKE_TYPES)) {
        recordCoordinatorWake(this.telemetry, 1)
      }
    }
    try {
      await this.messenger?.consumeEnvelope(prompt.sessionId, {
        sessionId: prompt.sessionId,
        kind: "message",
        message: prompt.text,
        directory: prompt.directory,
        createdAt: prompt.createdAt ?? event?.createdAt ?? nowIso,
      })
    } catch (error) {
      console.warn("[kilo-foundation] managed inbox consume failed", error)
    }
    this.compact()
  }

  async dropLastPrompt(sessionId: string, text: string): Promise<void> {
    const pending = [...unconsumedManaged(this.events)]
      .reverse()
      .find((event) => event.sessionId === sessionId && isMessagePrompt(event) && event.payload.text === text)
    const prompt = pending ? promptFromEvent(pending) : undefined
    if (!prompt) return
    await this.acknowledgeSent(prompt)
  }

  forgetSession(sessionId: string): void {
    forgetManagedSession(this.events, sessionId)
    void this.messenger?.dropSession(sessionId).catch((error) => {
      console.warn("[kilo-foundation] managed inbox drop session failed", error)
    })
  }

  compact(): void {
    compactConsumed(this.events)
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
          {
            sessionId,
            directory: envelope.directory,
            text: envelope.message,
            extra: extraFromUnknown(envelope.extra),
            createdAt: envelope.createdAt,
          },
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
  extra?: PromptAsyncExtra
}): DeliveryResult | "pass" {
  if (!input.busy || (input.fileCount ?? 0) > 0) return "pass"
  const text = input.text?.trim()
  if (!input.sessionId || !input.directory || !text) return "pass"
  void managedInbox
    .enqueuePrompt({ sessionId: input.sessionId, directory: input.directory, text, extra: input.extra })
    .catch((error) => {
      console.warn("[kilo-foundation] managed inbox enqueue failed", error)
    })
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
    await managedInbox.enqueuePrompt({
      sessionId: input.sessionId,
      directory: input.directory,
      text: input.text,
      extra: input.extra,
    })
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
  let sent = 0
  while (sent < 10) {
    const item = managedInbox.peekForSession(sessionId)
    if (!item) return sent
    await client.session.promptAsync(promptBody(item.sessionId, item.directory, item.text, { ...extra, ...item.extra }), {
      throwOnError: true,
    })
    await managedInbox.acknowledgeSent(item)
    sent++
  }
  return sent
}

export async function flushQueuedSessions(client: PromptClient, extra?: PromptAsyncExtra): Promise<number> {
  let sent = 0
  for (const sessionId of managedInbox.pendingSessionIds()) {
    const n = await flushIdleSession(client, sessionId, extra)
    if (n > 0) {
      recordResume(managedInbox.telemetry)
      sent += n
    }
  }
  return sent
}

export async function resumeQueuedSessions(client: PromptClient, extra?: PromptAsyncExtra): Promise<number> {
  await managedInbox.hydrate()
  return flushQueuedSessions(client, extra)
}
