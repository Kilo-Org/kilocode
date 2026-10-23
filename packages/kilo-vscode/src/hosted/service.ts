import type {
  KiloClient,
  Message,
  Part,
  Session,
  SessionHostProviderStatus,
  SessionHostStartInput,
} from "@kilocode/sdk/v2/client"
import { hostedKey, parseHostedKey, type HostedIdentity } from "./identity"
import { attachmentFailure, isRecoverable, type AttachmentFailure } from "./failure"
import { HostedRegistry, type Attachment, type AttachmentPort } from "./registry"
import { classifyFrame, retag } from "./events"

export interface HostedSessionSummary {
  key: string
  providerID: string
  sessionID: string
  title: string
  created: number
  updated: number
  directory?: string
}

export interface HostedTurn {
  info: Message
  parts: Part[]
}

export interface HostedOpen {
  key: string
  session: Session
  items: HostedTurn[]
  cursor?: string
  omitted?: number
}

export interface HostedStart {
  key: string
  providerID: string
  sessionID: string
  replayed: boolean
  delivery: "sent" | "queued"
}

export interface HostedStartInput {
  repository: SessionHostStartInput["repository"]
  prompt: string
  mode: string
  model: string
  organizationID?: string
  operationKey: string
  messageID: string
}

export type HostedHit = (payload: unknown) => void
export type HostedUnsubscribe = () => void

interface Stream {
  abort: AbortController
  listeners: Set<HostedHit>
  failures: Set<(failure: AttachmentFailure) => void>
  snapshots: Set<() => void>
}

const RECONNECT_MS = 500
const RECONNECT_MAX_MS = 5_000

/**
 * Hosted session access through the shared local backend.
 *
 * Durable reads never attach. Live work attaches lazily and re-attaches once
 * after a recoverable failure; an unrecoverable failure is surfaced, never
 * answered with a local session.
 */
export class HostedService {
  private readonly registry = new HostedRegistry()
  private readonly identities = new Map<string, HostedIdentity>()
  private readonly streams = new Map<string, Stream>()
  private providers_cache: SessionHostProviderStatus[] = []

  constructor(private readonly client: () => KiloClient | null) {}

  private port(): AttachmentPort {
    const client = this.client()
    if (!client) throw new Error("Not connected to the local Kilo backend")
    return {
      attach: async (input) => {
        const { data } = await client.sessionHost.attach(input, { throwOnError: true })
        return { attachmentID: data.attachmentID, expiresAt: data.expiresAt }
      },
      detach: async (attachmentID) => {
        await client.sessionHost.detach({ attachmentID }, { throwOnError: true }).catch(() => undefined)
      },
    }
  }

  private require(): KiloClient {
    const client = this.client()
    if (!client) throw new Error("Not connected to the local Kilo backend")
    return client
  }

  remember(providerID: string, sessionID: string): string {
    const key = hostedKey(providerID, sessionID)
    this.identities.set(key, { providerID, sessionID })
    return key
  }

  identity(key: string): HostedIdentity | undefined {
    return this.identities.get(key) ?? parseHostedKey(key)
  }

  async providers(): Promise<SessionHostProviderStatus[]> {
    const { data } = await this.require().sessionHost.providers({ throwOnError: true })
    this.providers_cache = data.providers
    return data.providers
  }

  cache(): SessionHostProviderStatus[] {
    return this.providers_cache
  }

  async list(limit = 50): Promise<HostedSessionSummary[]> {
    const { data } = await this.require().sessionHost.list({ limit: String(limit) }, { throwOnError: true })
    return data.items.map((item) => {
      const key = this.remember(item.id.providerID, item.id.sessionID)
      return {
        key,
        providerID: item.id.providerID,
        sessionID: item.id.sessionID,
        title: item.session.title,
        created: item.session.time.created,
        updated: item.session.time.updated,
        directory: item.session.directory,
      }
    })
  }

  /** Opens a hosted session from durable history only. Never attaches or wakes compute. */
  async open(providerID: string, sessionID: string, limit = 80): Promise<HostedOpen> {
    const key = this.remember(providerID, sessionID)
    const client = this.require()
    const [detail, page] = await Promise.all([
      client.sessionHost.get({ providerID, sessionID }, { throwOnError: true }),
      client.sessionHost.transcript({ providerID, sessionID, limit: String(limit) }, { throwOnError: true }),
    ])
    return {
      key,
      session: detail.data.session,
      items: page.data.items,
      cursor: page.data.cursor,
      omitted: page.data.omitted,
    }
  }

  async transcript(key: string, before?: string, limit = 80): Promise<{ items: HostedTurn[]; cursor?: string }> {
    const identity = this.need(key)
    const { data } = await this.require().sessionHost.transcript(
      {
        providerID: identity.providerID,
        sessionID: identity.sessionID,
        limit: String(limit),
        ...(before ? { before } : {}),
      },
      { throwOnError: true },
    )
    return { items: data.items, ...(data.cursor ? { cursor: data.cursor } : {}) }
  }

  async start(input: HostedStartInput): Promise<HostedStart> {
    const { data } = await this.require().sessionHost.start(
      {
        sessionHostStartInput: {
          repository: input.repository,
          prompt: input.prompt,
          agent: { mode: input.mode, model: input.model },
          ...(input.organizationID ? { organizationID: input.organizationID } : {}),
          origin: "desktop",
          operationKey: input.operationKey,
          messageID: input.messageID,
        },
      },
      { throwOnError: true },
    )
    const key = this.remember(data.session.providerID, data.session.sessionID)
    return {
      key,
      providerID: data.session.providerID,
      sessionID: data.session.sessionID,
      replayed: data.replayed,
      delivery: data.delivery,
    }
  }

  async attach(key: string): Promise<string> {
    const identity = this.need(key)
    const entry = await this.registry.ensure(key, identity, this.port())
    return entry.attachmentID
  }

  async detach(key: string): Promise<void> {
    this.stop(key)
    await this.registry.detach(key, this.port())
  }

  /** Backend restarts invalidate every attachment. */
  reset(): void {
    for (const [key, stream] of [...this.streams]) {
      this.streams.delete(key)
      stream.abort.abort()
      // Tell clients the stream is gone so they can resubscribe after reconnect.
      for (const hit of stream.failures) {
        hit({ code: "unavailable", message: "The local Kilo backend restarted", recoverable: true })
      }
    }
    this.registry.reset()
    this.providers_cache = []
  }

  /**
   * Runs one native request against the current attachment. A recoverable
   * attachment failure mints exactly one replacement and retries; anything
   * else is surfaced, and no request ever falls back to local routing.
   */
  private async withAttachment<T>(key: string, run: (attachmentID: string) => Promise<T>): Promise<T> {
    const attachmentID = await this.attach(key)
    try {
      return await run(attachmentID)
    } catch (error) {
      if (!isRecoverable(error)) throw error
      this.registry.invalidate(key)
      return run(await this.attach(key))
    }
  }

  async prompt(
    key: string,
    input: {
      messageID: string
      parts: Array<Record<string, unknown>>
      agent?: string
      model?: { providerID: string; modelID: string }
      variant?: string
      editorContext?: Record<string, unknown>
    },
  ): Promise<void> {
    const identity = this.need(key)
    await this.withAttachment(key, (workspace) =>
      this.require().session.promptAsync(
        {
          sessionID: identity.sessionID,
          workspace,
          messageID: input.messageID,
          parts: input.parts as never,
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.variant ? { variant: input.variant } : {}),
          ...(input.editorContext ? { editorContext: input.editorContext as never } : {}),
        },
        { throwOnError: true },
      ),
    )
  }

  async abort(key: string): Promise<void> {
    const identity = this.need(key)
    await this.withAttachment(key, (workspace) =>
      this.require().session.abort({ sessionID: identity.sessionID, workspace }, { throwOnError: true }),
    )
  }

  async messages(key: string, input: { limit: number; before?: string }) {
    const identity = this.need(key)
    return this.withAttachment(key, (workspace) =>
      this.require().session.messages(
        {
          sessionID: identity.sessionID,
          workspace,
          limit: input.limit,
          ...(input.before ? { before: input.before } : {}),
        },
        { throwOnError: true },
      ),
    )
  }

  async session(key: string): Promise<Session> {
    const identity = this.need(key)
    const result = await this.withAttachment(key, (workspace) =>
      this.require().session.get({ sessionID: identity.sessionID, workspace }, { throwOnError: true }),
    )
    return result.data
  }

  /** Re-reads every state surface after continuity could not be proven. */
  async resnapshot(key: string): Promise<HostedOpen> {
    const identity = this.need(key)
    return this.open(identity.providerID, identity.sessionID)
  }

  async replyQuestion(key: string, requestID: string, answers: string[][]): Promise<void> {
    await this.withAttachment(key, (workspace) =>
      this.require().question.reply({ requestID, workspace, answers: answers as never }, { throwOnError: true }),
    )
  }

  async rejectQuestion(key: string, requestID: string): Promise<void> {
    await this.withAttachment(key, (workspace) =>
      this.require().question.reject({ requestID, workspace }, { throwOnError: true }),
    )
  }

  async replyPermission(key: string, requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    await this.withAttachment(key, (workspace) =>
      this.require().permission.reply({ requestID, workspace, reply }, { throwOnError: true }),
    )
  }

  async pending(
    key: string,
  ): Promise<{ questions: unknown[]; permissions: unknown[]; status: Record<string, { type: string }> }> {
    return this.withAttachment(key, async (workspace) => {
      const client = this.require()
      const [questions, permissions, status] = await Promise.all([
        client.question.list({ workspace }, { throwOnError: true }),
        client.permission.list({ workspace }, { throwOnError: true }),
        client.session.status({ workspace }, { throwOnError: true }),
      ])
      return { questions: questions.data, permissions: permissions.data, status: status.data }
    })
  }

  subscribe(
    key: string,
    listener: HostedHit,
    onFailure?: (failure: AttachmentFailure) => void,
    onSnapshot?: () => void,
  ): HostedUnsubscribe {
    const stream = this.streams.get(key) ?? this.begin(key)
    stream.listeners.add(listener)
    if (onFailure) stream.failures.add(onFailure)
    if (onSnapshot) stream.snapshots.add(onSnapshot)
    return () => {
      stream.listeners.delete(listener)
      if (onFailure) stream.failures.delete(onFailure)
      if (onSnapshot) stream.snapshots.delete(onSnapshot)
      if (stream.listeners.size === 0) this.stop(key)
    }
  }

  private begin(key: string): Stream {
    const stream: Stream = {
      abort: new AbortController(),
      listeners: new Set(),
      failures: new Set(),
      snapshots: new Set(),
    }
    this.streams.set(key, stream)
    void this.run(key, stream)
    return stream
  }

  private stop(key: string): void {
    const stream = this.streams.get(key)
    if (!stream) return
    this.streams.delete(key)
    stream.abort.abort()
  }

  private need(key: string): HostedIdentity {
    const identity = this.identity(key)
    if (!identity) throw new Error(`Not a hosted session key: ${key}`)
    return identity
  }

  private async run(key: string, stream: Stream): Promise<void> {
    const identity = this.need(key)
    let delay = RECONNECT_MS
    while (!stream.abort.signal.aborted) {
      let attachmentID: string
      try {
        attachmentID = await this.attach(key)
      } catch (error) {
        this.stop(key)
        this.fail(stream, error)
        return
      }
      try {
        const events = await this.require().event.subscribe(
          { workspace: attachmentID },
          { signal: stream.abort.signal, sseMaxRetryAttempts: 1 },
        )
        delay = RECONNECT_MS
        for await (const item of events.stream) {
          if (stream.abort.signal.aborted) return
          const frame = classifyFrame(item)
          if (frame.kind === "resnapshot") {
            for (const hit of stream.snapshots) hit()
            continue
          }
          if (frame.kind !== "event") continue
          const payload = retag(frame.payload, identity.sessionID, key)
          for (const hit of stream.listeners) hit(payload)
        }
      } catch (error) {
        if (stream.abort.signal.aborted) return
        const failure = attachmentFailure(error)
        if (failure?.recoverable) {
          this.registry.invalidate(key)
        } else {
          this.stop(key)
          this.fail(stream, error)
          return
        }
      }
      if (stream.abort.signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }
  }

  private fail(stream: Stream, error: unknown) {
    const failure = attachmentFailure(error)
    const value: AttachmentFailure = failure ?? {
      code: "unavailable",
      message: error instanceof Error ? error.message : "Hosted session is unavailable",
      recoverable: false,
    }
    for (const hit of stream.failures) hit(value)
  }

  /** Test/inspection hook: the current attachment for a key, when one exists. */
  attachment(key: string): Attachment | undefined {
    return this.registry.get(key)
  }
}
