import { Effect, Schema } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { resumeHint } from "../task-resume"
import { KiloPartLifecycle } from "./part-lifecycle"

const task = "task"
type Ops = Pick<Session.Interface, "get" | "messages" | "create" | "updateMessage" | "updatePart">

export function forkWriter(events: EventV2.Interface, ops: Pick<Ops, "get" | "messages" | "create">) {
  const pending: Parameters<EventV2.Interface["publishAll"]>[0][number][] = []
  const flush = Effect.suspend(() => {
    if (!pending.length) return Effect.void
    return events.publishAll(pending.splice(0), { metadata: { fork: true } })
  })
  return {
    ...ops,
    flush,
    messages: (input: Parameters<Ops["messages"]>[0]) => flush.pipe(Effect.andThen(ops.messages(input))),
    updateMessage: <T extends MessageV2.Info>(info: T): Effect.Effect<T> =>
      Effect.sync(() => {
        pending.push({ definition: SessionV1.Event.MessageUpdated, data: { sessionID: info.sessionID, info } })
        return info
      }),
    updatePart: <T extends MessageV2.Part>(part: T): Effect.Effect<T> =>
      Effect.sync(() => {
        pending.push({
          definition: SessionV1.Event.PartUpdated,
          data: { sessionID: part.sessionID, part, time: Date.now() },
        })
        return part
      }),
  }
}

// Keep terminal task references so the fork can give them private child sessions.
// In-flight jobs cannot be copied safely, so those remain historical errors.
export function prepareForkedPart(part: MessageV2.Part): MessageV2.Part | undefined {
  if (KiloPartLifecycle.transient(part)) return undefined
  if (
    part.type === "tool" &&
    part.tool === task &&
    (part.state.status === "pending" || part.state.status === "running")
  ) {
    return structuredClone(detachPart(part))
  }
  return structuredClone(part)
}

function childID(part: MessageV2.Part) {
  if (part.type !== "tool" || part.tool !== task) return undefined
  const state = part.state
  const metadata = state.status === "pending" ? undefined : state.metadata
  const values = [
    metadata?.sessionId,
    metadata?.sessionID,
    part.metadata?.sessionId,
    part.metadata?.sessionID,
    state.input.task_id,
  ]
  return values.find((value): value is string => typeof value === "string")
}

function mapRecord(value: Record<string, unknown> | undefined, map: Map<string, SessionID>, keys: string[]) {
  if (!value) return value
  const copy = { ...value }
  for (const key of keys) {
    const id = copy[key]
    if (typeof id !== "string") continue
    const replacement = map.get(id)
    if (replacement) copy[key] = replacement
  }
  return copy
}

function output(value: string, map: Map<string, SessionID>) {
  return [...map].reduce(
    (text, [source, target]) => (source === target ? text : text.replaceAll(source, target)),
    value,
  )
}

function remapPart(part: MessageV2.Part, map: Map<string, SessionID>) {
  if (part.type === "text") {
    const text = output(part.text, map)
    return text === part.text ? part : { ...part, text }
  }
  if (part.type !== "tool" || part.tool !== task) return part
  const next = structuredClone(part)
  next.metadata = mapRecord(next.metadata, map, ["sessionId", "sessionID", "parentSessionId", "parentSessionID"])
  const input = mapRecord(next.state.input, map, ["task_id"])
  if (input) next.state.input = input
  if (next.state.status !== "pending") {
    const metadata = mapRecord(next.state.metadata, map, [
      "sessionId",
      "sessionID",
      "parentSessionId",
      "parentSessionID",
    ])
    if (metadata) next.state.metadata = metadata
  }
  if (next.state.status === "completed") next.state.output = output(next.state.output, map)
  if (next.state.status === "error") next.state.error = output(next.state.error, map)
  return next
}

function copy(input: { source: Session.Info; parentID: SessionID; ops: Ops }) {
  return Effect.gen(function* () {
    const target = yield* input.ops.create({
      parentID: input.parentID,
      title: input.source.title,
      agent: input.source.agent,
      model: input.source.model,
      metadata: structuredClone(input.source.metadata),
      permission: input.source.permission ? [...input.source.permission] : undefined,
      workspaceID: input.source.workspaceID,
    })
    const msgs = yield* input.ops.messages({ sessionID: input.source.id })
    const ids = new Map<string, MessageID>()

    for (const msg of msgs) {
      const id = MessageID.ascending()
      ids.set(msg.info.id, id)
      const parentID = msg.info.role === "assistant" ? ids.get(msg.info.parentID) : undefined
      const cloned = yield* input.ops.updateMessage({
        ...msg.info,
        id,
        sessionID: target.id,
        ...(msg.info.role === "assistant" && { cost: 0 }),
        ...(parentID && { parentID }),
      })

      for (const part of msg.parts) {
        const prepared = prepareForkedPart(part)
        if (!prepared) continue
        const next: MessageV2.Part = {
          ...prepared,
          id: PartID.ascending(),
          messageID: cloned.id,
          sessionID: target.id,
          ...(prepared.type === "step-finish" && { cost: 0 }),
        }
        if (next.type === "compaction" && next.tail_start_id) next.tail_start_id = ids.get(next.tail_start_id)
        yield* input.ops.updatePart(next)
      }
    }

    return target
  })
}

export function remapChildren(input: {
  sessionID: SessionID
  ops: Ops
  remapped?: Map<string, SessionID>
}): Effect.Effect<void, Session.NotFound> {
  return Effect.gen(function* () {
    const map = input.remapped ?? new Map<string, SessionID>()
    const msgs = yield* input.ops.messages({ sessionID: input.sessionID })
    const refs = msgs.flatMap((msg) =>
      msg.parts.flatMap((part) => {
        const child = childID(part)
        return child ? [{ part, child }] : []
      }),
    )

    for (const ref of refs) {
      if (map.has(ref.child)) continue
      if (!Schema.is(SessionID)(ref.child)) continue
      const source = yield* input.ops.get(SessionID.make(ref.child)).pipe(Effect.orElseSucceed(() => undefined))
      if (!source) continue
      const target = yield* copy({ source, parentID: input.sessionID, ops: input.ops })
      map.set(ref.child, target.id)
      yield* remapChildren({ sessionID: target.id, ops: input.ops, remapped: map })
    }

    for (const msg of msgs) {
      for (const part of msg.parts) {
        const next = remapPart(part, map)
        if (next !== part) yield* input.ops.updatePart(next)
      }
    }
  })
}

function detachPart(part: MessageV2.Part): MessageV2.Part {
  if (part.type !== "tool" || part.tool !== task) return part

  const child = childID(part)
  const hint = child ? `\n${resumeHint(child)}` : ""
  const top = metadata(part.metadata)
  const state = part.state
  if (state.status === "pending") {
    const now = Date.now()
    return {
      ...part,
      metadata: top,
      state: {
        status: "error",
        input: input(state.input),
        error: `Task was still pending when this session was forked.${hint}`,
        time: { start: now, end: now },
      },
    }
  }

  return {
    ...part,
    metadata: top,
    state: {
      status: "error",
      input: input(state.input),
      error: `Task was still running when this session was forked.${hint}`,
      metadata: metadata(state.metadata),
      time: { start: state.time.start, end: Date.now() },
    },
  }
}

function metadata(value: Record<string, unknown> | undefined) {
  if (!value) return value
  return { ...value }
}

function input(value: Record<string, unknown>) {
  return { ...value }
}
