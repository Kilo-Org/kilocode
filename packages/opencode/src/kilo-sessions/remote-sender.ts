import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"
import type { RemoteWS } from "@/kilo-sessions/remote-ws"
import { GlobalBus } from "@/bus/global"
// kilocode_change - AppRuntime is imported lazily inside dispatch() below to break a
// module init cycle: Worktree → project/bootstrap → kilo-sessions → remote-sender →
// app-runtime → Worktree. Static import here caused Worktree.defaultLayer to be
// undefined when app-runtime evaluated during tests that import Worktree.
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Question } from "@/question"
import { Suggestion } from "@/kilocode/suggestion" // kilocode_change
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionID } from "@/session/schema"
import { QuestionID } from "@/question/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Log } from "@/util/log"
import z from "zod"

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

// kilocode_change start — lazy init to avoid circular dependency
// (Server → RemoteRoutes → RemoteSender → SessionPrompt at module load time)
let _remotePromptInput: ReturnType<typeof SessionPrompt.PromptInput.extend> | undefined
function getRemotePromptInput() {
  return (_remotePromptInput ??= SessionPrompt.PromptInput.extend({
    model: z.string().optional(),
  }))
}
// kilocode_change end
function normalizeModel(model: string | undefined) {
  if (!model) return undefined
  return {
    providerID: ProviderID.make("kilo"),
    modelID: ModelID.make(model.startsWith("kilocode/") ? model.slice("kilocode/".length) : model),
  }
}

function normalizePrompt(input: SessionPrompt.PromptInput & { model?: string }): SessionPrompt.PromptInput {
  return {
    ...input,
    model: normalizeModel(input.model),
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
    provide?: typeof Instance.provide
  }

  export type Sender = {
    handle(msg: RemoteProtocol.Inbound): void
    dispose(): void
  }

  export function create(options: Options): Sender {
    const sessions = new Set<string>()
    const children = new Map<string, string>() // childId → parentId
    let unsub: (() => void) | undefined

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
      const info = await Session.get(SessionID.make(sid)).catch(() => undefined)
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
      const provide = options.provide ?? Instance.provide
      try {
        const dir = await directoryFor(parentId)
        await provide({
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
      const [suggestions, questions, permissions] = await Promise.all([
        Suggestion.list(),
        Question.list(),
        Permission.list(),
      ])
      for (const suggestion of suggestions) {
        if (suggestion.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          event: "suggestion.shown",
          data: suggestion,
        })
      }
      for (const q of questions) {
        if (q.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          event: "question.asked",
          data: q,
        })
      }
      for (const p of permissions) {
        if (p.sessionID !== sessionId) continue
        options.conn.send({
          type: "event",
          sessionId,
          event: "permission.asked",
          data: p,
        })
      }
    }

    async function backfillPendingState(sessionId: string) {
      const provide = options.provide ?? Instance.provide
      try {
        const dir = await directoryFor(sessionId)
        await provide({
          directory: dir,
          fn: () => replay(sessionId),
        })
      } catch (e) {
        options.log.error("backfill pending state failed", { sessionId, error: String(e) })
      }
    }

    async function discoverChildren(parentId: string) {
      const childSessions = await Session.children(SessionID.make(parentId))
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
      const provide = options.provide ?? Instance.provide
      options.conn.send({ type: "response", id: msg.id, result: {} })
      void (async () => {
        try {
          await provide({ directory: await dir, fn: work })
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
      const provide = options.provide ?? Instance.provide
      void (async () => {
        try {
          await provide({ directory: await dir, fn: work })
          options.conn.send({ type: "response", id: msg.id, result: {} })
        } catch (e) {
          options.conn.send({ type: "response", id: msg.id, error: String(e) })
        }
      })()
    }

    function dispatch(msg: RemoteProtocol.Command) {
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
        const input = SessionPrompt.PromptInput.safeParse(
          normalizePrompt(parsed.data as SessionPrompt.PromptInput & { model?: string }),
        )
        if (!input.success) {
          options.conn.send({
            type: "response",
            id: msg.id,
            error: "invalid send_message data: " + input.error.message,
          })
          return
        }
        dispatchLongRunning(msg, directoryFor(input.data.sessionID), async () => {
          await SessionPrompt.prompt(input.data)
        })
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
          Question.reply({ ...parsed.data, requestID: QuestionID.make(parsed.data.requestID) }),
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
        dispatchQuick(msg, dir, () => Question.reject(QuestionID.make(parsed.data.requestID)))
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
          const { AppRuntime } = await import("@/effect/app-runtime")
          await AppRuntime.runPromise(
            Permission.Service.use((svc) =>
              svc.reply({ ...parsed.data, requestID: PermissionID.make(parsed.data.requestID) }),
            ),
          )
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
