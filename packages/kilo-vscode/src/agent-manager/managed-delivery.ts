import {
  consumeManagedBatch,
  enqueueManaged,
  FOUNDATION_EVENT,
  FOUNDATION_WAKE_TYPES,
  mapKiloRuntimeStatus,
  recordCoordinatorWake,
  resumeDecision,
  shouldWakeCoordinator,
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
}

type PromptAsyncParameters = {
  sessionID: string
  directory?: string
  parts: Array<{ type: "text"; text: string }>
} & PromptAsyncExtra

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

/**
 * In-memory managed inbox for Agent Manager. Queues prompts while a session is
 * mid-generation and flushes them when `session.status` becomes idle.
 */
export class ManagedSessionInbox {
  readonly events: ManagedEvent[] = []
  readonly telemetry = createGenericTelemetry()

  enqueuePrompt(input: QueuedPrompt, nowIso = new Date().toISOString()): void {
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

  takeForSession(sessionId: string, nowIso = new Date().toISOString()): QueuedPrompt[] {
    const pending = this.events.filter((event) => event.sessionId === sessionId && event.consumedAt === undefined)
    const batch = consumeManagedBatch(pending, 10, nowIso)
    if (batch.length > 0 && shouldWakeCoordinator(FOUNDATION_EVENT.MESSAGE_RECEIVED, FOUNDATION_WAKE_TYPES)) {
      recordCoordinatorWake(this.telemetry, batch.length)
    }
    return batch.flatMap((event) => {
      const text = typeof event.payload.text === "string" ? event.payload.text : undefined
      const directory = typeof event.payload.directory === "string" ? event.payload.directory : undefined
      if (!text || !directory) return []
      return [{ sessionId, directory, text }]
    })
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
  managedInbox.enqueuePrompt({ sessionId: input.sessionId, directory: input.directory, text })
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
    managedInbox.enqueuePrompt({ sessionId: input.sessionId, directory: input.directory, text: input.text })
    return "queued"
  }
  if (decision === "fail") {
    return "rejected"
  }
  await client.session.promptAsync(
    {
      sessionID: input.sessionId,
      directory: input.directory,
      parts: [{ type: "text", text: input.text }],
      ...input.extra,
    },
    { throwOnError: true },
  )
  return "sent"
}

export async function flushIdleSession(
  client: PromptClient,
  sessionId: string,
  extra?: PromptAsyncExtra,
): Promise<number> {
  const queued = managedInbox.takeForSession(sessionId)
  for (const item of queued) {
    await client.session.promptAsync(
      {
        sessionID: item.sessionId,
        directory: item.directory,
        parts: [{ type: "text", text: item.text }],
        ...extra,
      },
      { throwOnError: true },
    )
  }
  return queued.length
}
