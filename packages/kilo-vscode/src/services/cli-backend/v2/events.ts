// Folds the Kilo v2 event stream into the v1 global events that the extension already handles: sync
// `message.updated.1` / `message.part.updated.1` / `session.*.1` envelopes, `message.part.delta`, `session.status`,
// and `session.turn.open` / `session.turn.close`. v2 emits no `session.status`; it comes from `session.execution.*`.
import type { AssistantMessage, GlobalEvent, Part, Session } from "@kilocode/sdk-v1/v2/client"
import type { ModelRef, SessionMessageAssistantTool, V2Event } from "@opencode/client"
import { assistantView, errorView, partID, permissionView, questionView, toolName, toolStateView, userView } from "./projection"
import type { Context } from "./projection"

type Payload = GlobalEvent["payload"]
type Of<T extends V2Event["type"]> = Extract<V2Event, { type: T }>
type Text = Extract<Part, { type: "text" | "reasoning" }>

type Turn = {
  info: AssistantMessage
  ctx: Context
  /** Next content index; it matches the index of the part in the stored v2 message. */
  next: number
  ids: Map<string, string>
  texts: Map<string, Text>
  tools: Map<string, SessionMessageAssistantTool>
}

type Live = { session: Session; parent: string; agent?: string; model?: ModelRef }

export type FoldOptions = {
  directory: () => string
  /** Loads a session that started before this stream connected. */
  session?: (id: string) => Promise<Session | undefined>
}

function at(event: V2Event): number {
  return "created" in event ? event.created : Date.now()
}

function owner(event: V2Event): string | undefined {
  const data: unknown = event.data
  if (!data || typeof data !== "object") return undefined
  if ("sessionID" in data && typeof data.sessionID === "string") return data.sessionID
  if ("form" in data && data.form && typeof data.form === "object" && "sessionID" in data.form)
    return String(data.form.sessionID)
  return undefined
}

type ToolValue = SessionMessageAssistantTool["state"]

function toolState(event: V2Event, state: ToolValue): ToolValue {
  const input = state.status === "streaming" ? {} : state.input
  const metadata = state.status === "streaming" ? undefined : state.metadata
  if (event.type === "session.tool.input.delta" && state.status === "streaming")
    return { status: "streaming", input: state.input + event.data.delta }
  if (event.type === "session.tool.input.ended") return { status: "streaming", input: event.data.text }
  if (event.type === "session.tool.called") return { status: "running", input: event.data.input, metadata: {} }
  if (event.type === "session.tool.progress")
    return { status: "running", input, metadata: { ...metadata, ...event.data.metadata } }
  if (event.type === "session.tool.success")
    return { status: "completed", input, content: event.data.content, metadata: event.data.metadata ?? metadata }
  if (event.type === "session.tool.failed")
    return {
      status: "error",
      input,
      error: event.data.error,
      content: event.data.content,
      metadata: event.data.metadata ?? metadata,
    }
  return state
}

const CATALOG = new Set([
  "provider.updated",
  "model.updated",
  "agent.updated",
  "config.updated",
  "integration.updated",
  "credential.updated",
  "credential.switched",
])

// Sync envelopes carry a sequence that the extension compares per session; keep it increasing across folds.
const clock = { value: 0 }
const tick = () => (clock.value = Math.max(clock.value + 1, Date.now()))

export class V2Events {
  private count = 0
  private readonly live = new Map<string, Live>()
  private readonly turns = new Map<string, Turn>()

  constructor(private readonly opts: FoldOptions) {}

  heartbeat(): GlobalEvent {
    return this.wrap({ id: this.id("heartbeat"), type: "server.heartbeat", properties: {} } as unknown as Payload)
  }

  async apply(event: V2Event): Promise<GlobalEvent[]> {
    // Load the session first, so every event of an older session carries its directory.
    const sid = owner(event)
    if (sid && event.type !== "session.created") await this.load(sid)
    if (event.type === "server.connected")
      return [this.wrap({ id: event.id, type: "server.connected", properties: {} }, event.location?.directory)]
    // The catalog fills in after startup and changes with credentials; the extension reloads it on global.disposed.
    if (CATALOG.has(event.type))
      return [this.wrap({ id: event.id, type: "global.disposed", properties: {} }, event.location?.directory)]
    if (event.type === "permission.asked")
      return this.emit(event, event.data.sessionID, [
        { id: event.id, type: "permission.asked", properties: permissionView(event.data) },
      ])
    if (event.type === "permission.replied")
      return this.emit(event, event.data.sessionID, [
        { id: event.id, type: "permission.replied", properties: event.data },
      ])
    if (event.type === "form.created")
      return this.emit(event, event.data.form.sessionID, [
        { id: event.id, type: "question.asked", properties: questionView(event.data.form) },
      ])
    if (event.type === "form.replied")
      return this.emit(event, event.data.sessionID, [
        {
          id: event.id,
          type: "question.replied",
          properties: {
            sessionID: event.data.sessionID,
            requestID: event.data.id,
            answers: Object.values(event.data.answer).map((value) =>
              Array.isArray(value) ? value.map(String) : [String(value)],
            ),
          },
        },
      ])
    if (event.type === "form.cancelled")
      return this.emit(event, event.data.sessionID, [
        {
          id: event.id,
          type: "question.rejected",
          properties: { sessionID: event.data.sessionID, requestID: event.data.id },
        },
      ])
    if (event.type === "session.created") return this.created(event)
    if (!event.type.startsWith("session.") || !("sessionID" in event.data)) return []
    return this.session(event)
  }

  private async session(event: V2Event): Promise<GlobalEvent[]> {
    const sid = (event.data as { sessionID: string }).sessionID
    const live = await this.load(sid)
    if (event.type === "session.deleted") {
      this.live.delete(sid)
      return this.emit(event, sid, [this.sync(event, "session.deleted.1", sid, { sessionID: sid, info: live.session })])
    }
    if (event.type === "session.renamed") return this.update(event, live, { title: event.data.title })
    if (event.type === "session.usage.updated")
      return this.update(event, live, { cost: event.data.cost, tokens: event.data.tokens })
    if (event.type === "session.agent.selected") {
      live.agent = event.data.agent
      return this.update(event, live, { agent: event.data.agent })
    }
    if (event.type === "session.model.selected") {
      live.model = event.data.model
      return this.update(event, live, { model: event.data.model })
    }
    if (event.type.startsWith("session.execution.")) return this.execution(event, sid)
    if (event.type === "session.retry.scheduled")
      return this.emit(event, sid, [
        {
          id: event.id,
          type: "session.status",
          properties: {
            sessionID: sid,
            status: {
              type: "retry",
              attempt: event.data.attempt,
              message: event.data.error.message,
              next: event.data.at,
            },
          },
        },
      ])
    if (event.type === "session.inbox.enqueued") return this.prompt(event, live)
    return this.step(event, live)
  }

  private execution(event: V2Event, sid: string): GlobalEvent[] {
    const status = (type: "busy" | "idle"): Payload => ({
      id: this.id(event.id),
      type: "session.status",
      properties: { sessionID: sid, status: { type } },
    })
    const close = (reason: "completed" | "error" | "interrupted" | "superseded"): Payload => ({
      id: this.id(event.id),
      type: "session.turn.close",
      properties: { sessionID: sid, reason },
    })
    if (event.type === "session.execution.started")
      return this.emit(event, sid, [
        { id: this.id(event.id), type: "session.turn.open", properties: { sessionID: sid } },
        status("busy"),
      ])
    if (event.type === "session.execution.succeeded") return this.emit(event, sid, [close("completed"), status("idle")])
    if (event.type === "session.execution.failed")
      return this.emit(event, sid, [
        {
          id: this.id(event.id),
          type: "session.error",
          properties: { sessionID: sid, error: errorView(event.data.error) },
        },
        close("error"),
        status("idle"),
      ])
    if (event.type !== "session.execution.interrupted") return []
    // Open steps never get a step event after an interrupt; close them so their busy state clears.
    const aborted = [...this.turns.values()]
      .filter((turn) => turn.ctx.sessionID === sid && !turn.info.time.completed)
      .map((turn) => {
        turn.info = {
          ...turn.info,
          time: { ...turn.info.time, completed: at(event) },
          error: { name: "MessageAbortedError", data: { message: "Interrupted" } },
        }
        return this.message(event, turn)
      })
    // A server shutdown is not a user-visible turn end.
    if (event.data.reason === "shutdown") return this.emit(event, sid, [...aborted, status("idle")])
    const reason = event.data.reason === "superseded" ? "superseded" : "interrupted"
    return this.emit(event, sid, [...aborted, close(reason), status("idle")])
  }

  private prompt(event: Of<"session.inbox.enqueued">, live: Live): GlobalEvent[] {
    const item = event.data.item
    if (item.type !== "user") return []
    live.parent = event.data.inboxID
    const view = userView(
      this.ctx(live),
      { id: event.data.inboxID, created: at(event), text: item.payload.text, metadata: item.payload.metadata },
      item.payload.files?.map((file) => ({
        uri: file.source.type === "uri" ? file.source.uri : undefined,
        mime: file.mime,
        name: file.name,
      })),
    )
    const sid = live.session.id
    return this.emit(event, sid, [
      this.sync(event, "message.updated.1", sid, { sessionID: sid, info: view.info }),
      ...view.parts.map((part) =>
        this.sync(event, "message.part.updated.1", sid, { sessionID: sid, part, time: at(event) }),
      ),
    ])
  }

  private step(event: V2Event, live: Live): GlobalEvent[] {
    if (!("assistantMessageID" in event.data)) return []
    const turn = this.turn(event, live, event.data.assistantMessageID)
    if (event.type.startsWith("session.step.")) return this.emit(event, live.session.id, this.lifecycle(event, turn))
    if (event.type.startsWith("session.tool.")) return this.emit(event, live.session.id, this.tool(event, turn))
    return this.emit(event, live.session.id, this.text(event, turn))
  }

  private part(event: V2Event, turn: Turn, part: Part): Payload {
    const sid = turn.ctx.sessionID
    return this.sync(event, "message.part.updated.1", sid, { sessionID: sid, part, time: at(event) })
  }

  private lifecycle(event: V2Event, turn: Turn): Payload[] {
    const base = { sessionID: turn.ctx.sessionID, messageID: turn.info.id }
    const done = { ...turn.info.time, completed: at(event) }
    if (event.type === "session.step.started")
      return [
        this.message(event, turn),
        this.part(event, turn, { ...base, id: partID.start(turn.info.id), type: "step-start" }),
      ]
    if (event.type === "session.step.failed") {
      turn.info = { ...turn.info, time: done, error: errorView(event.data.error) }
      return [this.message(event, turn)]
    }
    if (event.type !== "session.step.ended") return []
    const tokens = { ...event.data.tokens, cache: { ...event.data.tokens.cache } }
    turn.info = { ...turn.info, time: done, finish: event.data.finish, cost: event.data.cost, tokens }
    return [
      this.message(event, turn),
      this.part(event, turn, {
        ...base,
        id: partID.finish(turn.info.id),
        type: "step-finish",
        reason: event.data.finish,
        cost: event.data.cost,
        tokens,
      }),
    ]
  }

  private text(event: V2Event, turn: Turn): Payload[] {
    if (!("ordinal" in event.data)) return []
    const kind = event.type.startsWith("session.reasoning.") ? "reasoning" : "text"
    const id = this.slot(turn, `${kind}:${event.data.ordinal}`)
    const base = { sessionID: turn.ctx.sessionID, messageID: turn.info.id }
    const current = turn.texts.get(id) ?? { ...base, id, type: kind, text: "", time: { start: at(event) } }
    turn.texts.set(id, current)
    if ("delta" in event.data) {
      current.text += event.data.delta
      return [
        {
          id: this.id(event.id),
          type: "message.part.delta",
          properties: { ...base, partID: id, field: "text", delta: event.data.delta },
        },
      ]
    }
    if ("text" in event.data) {
      current.text = event.data.text
      current.time = { start: current.time?.start ?? at(event), end: at(event) }
    }
    return [this.part(event, turn, { ...current })]
  }

  private tool(event: V2Event, turn: Turn): Payload[] {
    const data = event.data
    if (!("id" in data) || typeof data.id !== "string") return []
    const call = data.id
    const tool = turn.tools.get(call) ?? {
      type: "tool" as const,
      id: call,
      name: "name" in data && typeof data.name === "string" ? data.name : "tool",
      state: { status: "streaming" as const, input: "" },
      time: { created: at(event) },
    }
    turn.tools.set(call, tool)
    tool.state = toolState(event, tool.state)
    if (event.type === "session.tool.called") tool.time = { ...tool.time, ran: at(event) }
    if (event.type === "session.tool.success" || event.type === "session.tool.failed")
      tool.time = { ...tool.time, completed: at(event) }
    return [
      this.part(event, turn, {
        sessionID: turn.ctx.sessionID,
        messageID: turn.info.id,
        id: this.slot(turn, `tool:${call}`),
        type: "tool",
        callID: call,
        tool: toolName(tool.name),
        state: toolStateView(turn.ctx, turn.info.id, tool),
      }),
    ]
  }

  private created(event: Of<"session.created">): GlobalEvent[] {
    const data = event.data
    const session: Session = {
      id: data.sessionID,
      slug: data.slug,
      version: data.version,
      projectID: data.projectID,
      directory: data.location.directory,
      parentID: data.parentID,
      title: data.title ?? "",
      agent: data.agent,
      model: data.model,
      metadata: data.metadata,
      time: { created: at(event), updated: at(event) },
    }
    this.live.set(session.id, { session, parent: "", agent: data.agent, model: data.model })
    return this.emit(event, session.id, [
      this.sync(event, "session.created.1", session.id, { sessionID: session.id, info: session }),
    ])
  }

  private update(event: V2Event, live: Live, patch: Partial<Session>): GlobalEvent[] {
    live.session = { ...live.session, ...patch, time: { ...live.session.time, updated: at(event) } }
    const sid = live.session.id
    return this.emit(event, sid, [this.sync(event, "session.updated.1", sid, { sessionID: sid, info: live.session })])
  }

  private turn(event: V2Event, live: Live, id: string): Turn {
    const known = this.turns.get(id)
    if (known) return known
    const step = event.type === "session.step.started" ? (event as Of<"session.step.started">).data : undefined
    const ctx = this.ctx(live)
    const turn: Turn = {
      info: assistantView(
        { ...ctx, parentID: live.parent },
        {
          id,
          agent: step?.agent ?? live.agent ?? "",
          model: step?.model ?? live.model ?? { id: "", providerID: "" },
          created: step?.started ?? at(event),
        },
      ),
      ctx,
      next: 0,
      ids: new Map(),
      texts: new Map(),
      tools: new Map(),
    }
    this.turns.set(id, turn)
    return turn
  }

  private slot(turn: Turn, key: string) {
    const known = turn.ids.get(key)
    if (known) return known
    const id = partID.content(turn.info.id, turn.next)
    turn.next += 1
    turn.ids.set(key, id)
    return id
  }

  private message(event: V2Event, turn: Turn): Payload {
    const sid = turn.ctx.sessionID
    return this.sync(event, "message.updated.1", sid, { sessionID: sid, info: turn.info })
  }

  private ctx(live: Live): Context {
    return { sessionID: live.session.id, directory: live.session.directory, agent: live.agent, model: live.model }
  }

  private async load(sid: string): Promise<Live> {
    const known = this.live.get(sid)
    if (known) return known
    const session = (await this.opts.session?.(sid).catch((err: unknown) => {
      console.warn("[Kilo New] v2: failed to load session for events:", err)
      return undefined
    })) ?? {
      id: sid,
      slug: sid,
      version: "v2",
      projectID: "",
      directory: this.opts.directory(),
      title: "",
      time: { created: 0, updated: 0 },
    }
    const live = { session, parent: "", agent: session.agent, model: session.model }
    this.live.set(sid, live)
    return live
  }

  private sync(event: V2Event, type: string, sid: string, data: unknown): Payload {
    const id = this.id(event.id)
    return { type: "sync", id, syncEvent: { type, id, seq: tick(), aggregateID: sid, data } } as Payload
  }

  private emit(event: V2Event, sid: string, payloads: Payload[]): GlobalEvent[] {
    const directory = this.live.get(sid)?.session.directory ?? event.location?.directory
    return payloads.map((payload) => this.wrap(payload, directory))
  }

  private id(kind: string) {
    this.count += 1
    return `${kind}:${String(this.count).padStart(8, "0")}`
  }

  private wrap(payload: Payload, directory?: string): GlobalEvent {
    return { directory: directory ?? this.opts.directory(), payload }
  }
}
