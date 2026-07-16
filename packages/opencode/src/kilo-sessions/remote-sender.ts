import { RemoteModelCatalog } from "@/kilo-sessions/remote-model-catalog"
import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"
import type { RemoteWS } from "@/kilo-sessions/remote-ws"
import { GlobalBus } from "@/bus/global"
import { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Question } from "@/question"
import { Suggestion } from "@/kilocode/suggestion" // kilocode_change
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue" // kilocode_change - replay current queue snapshot
import { Permission } from "@/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionID } from "@/session/schema"
import { QuestionID } from "@/question/schema"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import z from "zod"
import { zodObject } from "@opencode-ai/core/effect-zod"
import { Effect, Option, Schema } from "effect"

type Provide = typeof import("@/kilocode/instance").provide

async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
  const { provide } = await import("@/kilocode/instance")
  return provide(input)
}

const QuestionData = z.object({
  requestID: z.string(),
  answers: z.array(z.array(z.string())),
})

const PermissionData = z.object({
  requestID: z.string(),
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().optional(),
})

const SuggestionData = z.object({
  requestID: z.string(),
  index: z.number().int().nonnegative(),
})

const decodeSessionID = Schema.decodeUnknownOption(SessionID)

// kilocode_change start — lazy init to avoid circular dependency
// (Server → RemoteRoutes → RemoteSender → SessionPrompt at module load time)
type RemotePromptInput = Omit<SessionPrompt.PromptInput, "model"> & {
  model?: string | RemoteModelCatalog.ModelRef
}
let _remotePromptInput: z.ZodObject<any> | undefined
function getRemotePromptInput() {
  return (_remotePromptInput ??= zodObject(SessionPrompt.PromptInput).extend({
    model: z.union([z.string(), RemoteModelCatalog.ModelRef]).optional(),
  }))
}
// kilocode_change end
function normalizeModel(model: string | RemoteModelCatalog.ModelRef | undefined) {
  if (!model) return undefined
  if (typeof model !== "string") {
    return {
      providerID: ProviderV2.ID.make(model.providerID),
      modelID: ModelV2.ID.make(model.modelID),
    }
  }
  return {
    providerID: ProviderV2.ID.make("kilo"),
    modelID: ModelV2.ID.make(model.startsWith("kilocode/") ? model.slice("kilocode/".length) : model),
  }
}

function normalizePrompt(input: RemotePromptInput): SessionPrompt.PromptInput {
  return {
    ...input,
    model: normalizeModel(input.model),
    ephemeralTools: { interactive_terminal: false },
  }
}

export namespace RemoteSender {
  export type Options = {
    conn: RemoteWS.Connection
    directory: string
    log: {
      info: (...args: any[]) => void
      error: (...args: any[]) => void
      warn: (...args: any[]) => void
    }
    subscribe?: (callback: (event: any) => void) => () => void
    provide?: Provide
    permission?: {
      readonly list: () => Promise<ReadonlyArray<Permission.Request>>
      readonly reply: (input: Permission.ReplyInput) => Promise<void>
    }
    question?: {
      readonly list: () => Promise<ReadonlyArray<Question.Request>>
      readonly reply: (input: Parameters<Question.Interface["reply"]>[0]) => Promise<void>
      readonly reject: (requestID: QuestionID) => Promise<void>
    }
    prompt?: (input: SessionPrompt.PromptInput) => Promise<unknown>
    cancel?: (sessionID: SessionID) => Promise<void>
    session?: {
      readonly get: (sessionID: SessionID) => Promise<Session.Info>
      readonly children: (sessionID: SessionID) => Promise<Session.Info[]>
    }
    catalog?: {
      readonly get: (sessionID: SessionID) => Promise<Session.Info>
      readonly messages: (sessionID: SessionID) => Promise<MessageV2.WithParts[]>
      readonly providers: () => Promise<Record<ProviderV2.ID, Provider.Info>>
      readonly default: () => Promise<RemoteModelCatalog.ModelRef | undefined>
    }
  }

  export type Sender = {
    handle(msg: RemoteProtocol.Inbound): void
    dispose(): void
  }

  export function create(options: Options): Sender {
    const sessions = new Set<string>()
    const children = new Map<string, string>() // childId → parentId
    let unsub: (() => void) | undefined
    const permission = options.permission ?? {
      list: async () => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Permission.Service.use((svc) => svc.list()))
      },
      reply: async (input: Permission.ReplyInput) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Permission.Service.use((svc) => svc.reply(input)))
      },
    }
    const question = options.question ?? {
      list: async () => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
      },
      reply: async (input: Parameters<Question.Interface["reply"]>[0]) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Question.Service.use((svc) => svc.reply(input)))
      },
      reject: async (requestID: QuestionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(requestID)))
      },
    }
    const prompt =
      options.prompt ??
      (async (input: SessionPrompt.PromptInput) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.prompt(input)))
      })
    const cancel =
      options.cancel ??
      (async (sessionID: SessionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.cancel(sessionID)))
      })
    const catalog = options.catalog ?? {
      get: async (sessionID: SessionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      },
      messages: async (sessionID: SessionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(
          Session.Service.use((svc) =>
            svc
              .findMessage(sessionID, (message) => message.info.role === "user" && !!message.info.model)
              .pipe(Effect.map((message) => (Option.isSome(message) ? [message.value] : []))),
          ),
        )
      },
      providers: async () => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Provider.Service.use((svc) => svc.list()))
      },
      default: async () => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Provider.Service.use((svc) => svc.defaultModel()))
      },
    }
    const session = options.session ?? {
      get: async (sessionID: SessionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      },
      children: async (sessionID: SessionID) => {
        const { AppRuntime } = await import("@/effect/app-runtime")
        return AppRuntime.runPromise(Session.Service.use((svc) => svc.children(sessionID)))
      },
    }

    const sub =
      options.subscribe ??
      ((callback: (event: any) => void) => {
        const handler = (event: { directory?: string; payload: any }) => callback(event.payload)
        GlobalBus.on("event", handler)
        return () => {
          GlobalBus.off("event", handler)
        }
      })

    async function directoryFor(sid: string): Promise<string> {
      const info = await session.get(SessionID.make(sid)).catch(() => undefined)
      return info?.directory ?? options.directory
    }

    function subscribed(sid: string) {
      if (sessions.has(sid)) return true
      const root = rootOf(sid)
      return root ? sessions.has(root) : false
    }

    function rootOf(sid: string): string | undefined {
      const parent = children.get(sid)
      if (!parent) return undefined
      return rootOf(parent) ?? parent
    }

    async function backfillChildren(parentId: string) {
      const run = options.provide ?? provide
      try {
        const dir = await directoryFor(parentId)
        await run({
          directory: dir,
          fn: async () => {
            await discoverChildren(parentId)
          },
        })
      } catch (e) {
        options.log.error("backfill children failed", { parentId, error: String(e) })
      }
    }

    // Replay pending suggestions/questions/permissions so a newly-subscribed web client
    // sees state that was asked before it connected — analogous to the Cloud
    // Agent's `connected` event carrying pending question/permission fields.
    async function replay(sessionId: string) {
      const root = rootOf(sessionId)
      const [suggestions, questions, permissions] = await Promise.all([
        Suggestion.list(),
        question.list(),
        permission.list(),
      ])
      for (const suggestion of suggestions) {
        if (suggestion.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          ...(root ? { parentSessionId: root } : {}),
          event: "suggestion.shown",
          data: suggestion,
        })
      }
      for (const q of questions) {
        if (q.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          ...(root ? { parentSessionId: root } : {}),
          event: "question.asked",
          data: q,
        })
      }
      for (const p of permissions) {
        if (p.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          ...(root ? { parentSessionId: root } : {}),
          event: "permission.asked",
          data: p,
        })
      }
      // kilocode_change start - always send the current queue snapshot, including
      // empty, so a resubscribing client can reconcile stale "Queued" badges.
      // Uses send() directly (not publishQueueChanged) to avoid re-broadcasting
      // to every other subscriber. The forwarder already routes live
      // session.queue.changed events to subscribed clients via extractSessionId.
      const queued = KiloSessionPromptQueue.snapshot(SessionID.make(sessionId))
      options.conn.send({
        type: "event",
        sessionId,
        ...(root ? { parentSessionId: root } : {}),
        event: "session.queue.changed",
        data: { sessionID: sessionId, queued },
      })
      // kilocode_change end
    }

    async function backfillPendingState(sessionId: string) {
      const run = options.provide ?? provide
      try {
        const dir = await directoryFor(sessionId)
        await run({
          directory: dir,
          fn: () => replay(sessionId),
        })
      } catch (e) {
        options.log.error("backfill pending state failed", { sessionId, error: String(e) })
      }
    }

    async function discoverChildren(parentId: string) {
      const childSessions = await session.children(SessionID.make(parentId))
      for (const child of childSessions) {
        children.set(child.id, parentId)
        const root = rootOf(child.id) ?? parentId
        options.conn.send({
          type: "event",
          sessionId: child.id,
          parentSessionId: root,
          event: "session.created",
          data: { info: child },
        })
        await replay(child.id)
        await discoverChildren(child.id)
      }
    }

    // Extract session ID from the correct nested location depending on event type.
    // Different events store the session ID in different places:
    //   - Top-level: session.diff, session.turn.*, message.part.delta, session.status, session.idle
    //   - info.sessionID: message.updated
    //   - info.id: session.created, session.updated (the session's own ID)
    //   - part.sessionID: message.part.updated, message.part.removed
    function extractSessionId(props: any): string | undefined {
      if (!props) return undefined
      if (typeof props.sessionID === "string") return props.sessionID
      if (typeof props.info?.sessionID === "string") return props.info.sessionID
      if (typeof props.info?.id === "string") return props.info.id
      if (typeof props.part?.sessionID === "string") return props.part.sessionID
      return undefined
    }

    function forwarder(event: { type: string; properties?: any }) {
      // Track child sessions as they're created
      if (event.type === "session.created") {
        const parent = event.properties?.info?.parentID
        const child = event.properties?.info?.id
        if (parent && child) children.set(child, parent)
      }

      const sid = extractSessionId(event.properties)
      if (!sid || !subscribed(sid)) return
      const root = rootOf(sid)
      options.conn.send({
        type: "event",
        sessionId: sid,
        ...(root ? { parentSessionId: root } : {}),
        event: event.type,
        data: event.properties,
      })
    }

    function dispatchLongRunning(msg: RemoteProtocol.Command, dir: Promise<string>, work: () => Promise<void>) {
      const run = options.provide ?? provide
      options.conn.send({ type: "response", id: msg.id, result: {} })
      void (async () => {
        try {
          await run({ directory: await dir, fn: work })
        } catch (e) {
          options.log.error("long-running command failed after ACK", {
            id: msg.id,
            command: msg.command,
            error: String(e),
          })
        }
      })()
    }

    function dispatchQuick(msg: RemoteProtocol.Command, dir: Promise<string>, work: () => Promise<void>) {
      const run = options.provide ?? provide
      void (async () => {
        try {
          await run({ directory: await dir, fn: work })
          options.conn.send({ type: "response", id: msg.id, result: {} })
        } catch (e) {
          options.conn.send({ type: "response", id: msg.id, error: String(e) })
        }
      })()
    }

    function dispatch(msg: RemoteProtocol.Command) {
      if (msg.command === "list_models") {
        const parsed = RemoteModelCatalog.Request.safeParse(msg.data)
        const session = msg.sessionId ? decodeSessionID(msg.sessionId) : Option.none<SessionID>()
        if (!parsed.success || Option.isNone(session)) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid list_models command",
          })
          return
        }
        const run = options.provide ?? provide
        void (async () => {
          try {
            const info = await catalog.get(session.value)
            const result = await run({
              directory: info.directory,
              fn: async () => {
                const [providers, messages, fallback] = await Promise.all([
                  catalog.providers(),
                  catalog.messages(info.id),
                  catalog.default().catch((err) => {
                    options.log.warn("default model lookup failed", { error: String(err) })
                    return undefined
                  }),
                ])
                return RemoteModelCatalog.build({
                  providers,
                  session: info,
                  messages,
                  defaultModel: fallback,
                })
              },
            })
            options.conn.send({ type: "response", id: msg.id, result })
          } catch {
            options.log.error("list models command failed", { id: msg.id })
            options.conn.send({ type: "response", id: msg.id, error: "failed to list models" })
          }
        })()
        return
      }
      if (msg.command === "send_message") {
        const parsed = getRemotePromptInput().safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid send_message data: " + parsed.error.message,
          })
          return
        }
        const normalized = normalizePrompt(parsed.data as RemotePromptInput)
        const input = SessionPrompt.PromptInput.zod.safeParse(normalized)
        if (!input.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid send_message data: " + input.error.message,
          })
          return
        }
        const promptInput = { ...input.data, ephemeralTools: normalized.ephemeralTools } as SessionPrompt.PromptInput
        dispatchLongRunning(msg, directoryFor(promptInput.sessionID), async () => {
          await prompt(promptInput)
        })
        return
      }
      if (msg.command === "interrupt") {
        const session = msg.sessionId ? decodeSessionID(msg.sessionId) : Option.none<SessionID>()
        if (Option.isNone(session)) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid interrupt command",
          })
          return
        }
        dispatchQuick(msg, directoryFor(session.value), () => cancel(session.value))
        return
      }
      if (msg.command === "question_reply") {
        const parsed = QuestionData.safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid question_reply data: " + parsed.error.message,
          })
          return
        }
        const dir = msg.sessionId ? directoryFor(msg.sessionId) : Promise.resolve(options.directory)
        dispatchQuick(msg, dir, () =>
          question.reply({ ...parsed.data, requestID: QuestionID.make(parsed.data.requestID) }),
        )
        return
      }
      if (msg.command === "question_reject") {
        const parsed = z.object({ requestID: z.string() }).safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid question_reject data: " + parsed.error.message,
          })
          return
        }
        const dir = msg.sessionId ? directoryFor(msg.sessionId) : Promise.resolve(options.directory)
        dispatchQuick(msg, dir, () => question.reject(QuestionID.make(parsed.data.requestID)))
        return
      }
      if (msg.command === "suggestion_accept") {
        const parsed = SuggestionData.safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid suggestion_accept data: " + parsed.error.message,
          })
          return
        }
        const dir = msg.sessionId ? directoryFor(msg.sessionId) : Promise.resolve(options.directory)
        dispatchQuick(msg, dir, async () => {
          const ok = await Suggestion.accept(parsed.data)
          if (!ok) throw new Error("suggestion not found or invalid action index")
        })
        return
      }
      if (msg.command === "suggestion_dismiss") {
        const parsed = z.object({ requestID: z.string() }).safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid suggestion_dismiss data: " + parsed.error.message,
          })
          return
        }
        const dir = msg.sessionId ? directoryFor(msg.sessionId) : Promise.resolve(options.directory)
        dispatchQuick(msg, dir, async () => {
          await Suggestion.dismiss(parsed.data.requestID)
        })
        return
      }
      if (msg.command === "permission_respond") {
        const parsed = PermissionData.safeParse(msg.data)
        if (!parsed.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid permission_respond data: " + parsed.error.message,
          })
          return
        }
        const dir = msg.sessionId ? directoryFor(msg.sessionId) : Promise.resolve(options.directory)
        dispatchQuick(msg, dir, async () => {
          await permission.reply({ ...parsed.data, requestID: PermissionV1.ID.make(parsed.data.requestID) })
        })
        return
      }
      options.conn.send({
        type: "response",
        id: msg.id,
        error: `unknown command: ${msg.command}`,
      })
      options.log.warn("unknown command", { command: msg.command })
    }

    function handle(msg: RemoteProtocol.Inbound) {
      if (msg.type === "subscribe") {
        if (sessions.has(msg.sessionId)) return
        sessions.add(msg.sessionId)
        if (!unsub) unsub = sub(forwarder)
        void backfillChildren(msg.sessionId)
        void backfillPendingState(msg.sessionId)
        return
      }
      if (msg.type === "unsubscribe") {
        sessions.delete(msg.sessionId)
        const queue = [msg.sessionId]
        while (queue.length) {
          const id = queue.pop()!
          for (const [child, parent] of children) {
            if (parent === id) {
              children.delete(child)
              queue.push(child)
            }
          }
        }
        if (sessions.size === 0 && unsub) {
          unsub()
          unsub = undefined
        }
        return
      }
      if (msg.type === "command") {
        options.log.info("received command", { id: msg.id, command: msg.command })
        dispatch(msg)
        return
      }
      if (msg.type === "system") {
        options.log.info("system event", { event: msg.event })
        return
      }
    }

    function dispose() {
      if (unsub) {
        unsub()
        unsub = undefined
      }
      sessions.clear()
      children.clear()
    }

    return { handle, dispose }
  }
}
