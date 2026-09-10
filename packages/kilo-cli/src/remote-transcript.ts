import type {
  OpenCodeClient,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionMessageUser,
} from "@opencode-ai/client"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionV1 } from "@opencode-ai/schema/v1/session"
import { Effect, Option, Schema } from "effect"
import type { RemoteOutbound } from "./remote-protocol"

/**
 * Legacy v1 transcript translation for the remote relay. Frames are built
 * exclusively from source-proven fields: the current public projection
 * (session messages, session info, project worktree root) and the durable v2
 * event payloads. A frame whose required SessionV1 fields lack a proven
 * source is never emitted — the known gaps are recorded in
 * kilocode/baseline/remote-v2-parity.md.
 *
 * Parts are full-value upserts with stable producer-ordinal identities, never
 * delta appends: live text/reasoning deltas accumulate to the running full
 * value and re-upsert idempotently, and the ended/step.ended snapshots
 * reconcile the final value under the same id.
 */

export type TranscriptFrame = Extract<RemoteOutbound, { type: "event" }>

export interface TranscriptEvent {
  readonly type: string
  readonly created?: number
  readonly data: unknown
}

/**
 * Per-adapter translation state: live accumulated text/reasoning values
 * (bounded), tool names seen in input.started (recovered from the projection
 * when missed), and the location's worktree root per directory (static,
 * resolved
 * once). The assistant parentID is always derived from the projection, never
 * from event-only state.
 */
export interface RemoteTranscript {
  readonly streaming: Map<string, string>
  readonly toolCalls: Map<string, Map<string, { name?: string; input?: Record<string, unknown>; start?: number }>>
  readonly roots: Map<string, string>
}

const STREAMING_LIMIT = 128

export function createRemoteTranscript(): RemoteTranscript {
  return { streaming: new Map(), toolCalls: new Map(), roots: new Map() }
}

function frame(sessionId: string, parentSessionId: string | undefined, event: string, data: unknown): TranscriptFrame {
  return { type: "event", sessionId, ...(parentSessionId === undefined ? {} : { parentSessionId }), event, data }
}

function optionFrame<A>(decoder: (value: unknown) => Option.Option<A>, value: unknown): A | undefined {
  return Option.getOrUndefined(decoder(value))
}

const decodeUserInfo = Schema.decodeUnknownOption(SessionV1.User)
const decodeAssistantInfo = Schema.decodeUnknownOption(SessionV1.Assistant)
const decodeTextPart = Schema.decodeUnknownOption(SessionV1.TextPart)
const decodeReasoningPart = Schema.decodeUnknownOption(SessionV1.ReasoningPart)
const decodeToolPart = Schema.decodeUnknownOption(SessionV1.ToolPart)
const decodeFilePart = Schema.decodeUnknownOption(SessionV1.FilePart)

type ProjectionClient = Pick<OpenCodeClient, "session"> & Partial<Pick<OpenCodeClient, "message" | "project">>

interface FetchInput {
  readonly order?: "asc" | "desc"
  readonly cursor?: string
}

/**
 * Paginated newest-first projection fetch, bounded to a few pages so sessions
 * beyond the default page size still resolve their target messages.
 */
/**
 * Bounded newest-first projection walk: at most four pages (the endpoint's
 * 50-message default) — up to 200 messages — walking newest-first with the
 * public cursor. The visitor returns a value to stop, or undefined to keep
 * paging; the walk returns that value or undefined when exhausted.
 */
async function walkProjection<T>(
  client: ProjectionClient,
  sessionID: string,
  visit: (messages: ReadonlyArray<SessionMessageInfo>) => T | undefined,
): Promise<T | undefined> {
  if (!client.message) return undefined
  let cursor: string | undefined
  const collected: Array<SessionMessageInfo> = []
  for (let page = 0; page < 4; page++) {
    const response = await client.message
      .list({ sessionID, ...(cursor === undefined ? { order: "desc" as const } : { cursor }) })
      .then((value) => value as SessionMessagesResponse)
      .catch(() => undefined)
    if (response === undefined) return undefined
    collected.push(...response.data)
    const done = visit(collected)
    if (done !== undefined) return done
    cursor = response.cursor.next ?? undefined
    if (cursor === undefined) return undefined
  }
  return undefined
}

async function projectRoot(
  transcript: RemoteTranscript,
  client: ProjectionClient,
  directory: string,
): Promise<string | undefined> {
  const cached = transcript.roots.get(directory)
  if (cached !== undefined) return cached
  // Without the project namespace the v1 path.root has no source and the
  // assistant info frame is not emitted. directory (not canonical) is the
  // requested location's own checkout worktree.
  if (!client.project) return undefined
  const current = await client.project
    .current({ location: { directory } })
    .then((value) => value.directory)
    .catch(() => undefined)
  if (current !== undefined) transcript.roots.set(directory, current)
  return current
}

function rememberToolCall(
  transcript: RemoteTranscript,
  sessionID: string,
  callID: string,
  patch: { name?: string; input?: Record<string, unknown>; start?: number },
) {
  const known =
    transcript.toolCalls.get(sessionID) ??
    new Map<string, { name?: string; input?: Record<string, unknown>; start?: number }>()
  known.set(callID, { ...known.get(callID), ...patch })
  transcript.toolCalls.set(sessionID, known)
}

function toolCall(
  transcript: RemoteTranscript,
  sessionID: string,
  callID: string,
): { name?: string; input?: Record<string, unknown>; start?: number } | undefined {
  return transcript.toolCalls.get(sessionID)?.get(callID)
}

/** Bounded live accumulation: full running text per stable part key. */
function accumulate(transcript: RemoteTranscript, key: string, delta: string): string {
  const running = `${transcript.streaming.get(key) ?? ""}${delta}`
  transcript.streaming.set(key, running)
  if (transcript.streaming.size > STREAMING_LIMIT) {
    const oldest = transcript.streaming.keys().next().value
    if (oldest !== undefined) transcript.streaming.delete(oldest)
  }
  return running
}

function settleStreaming(transcript: RemoteTranscript, key: string): void {
  transcript.streaming.delete(key)
}

/**
 * The assistant's real parent user message: the nearest preceding user
 * message in the projection, derived from history so a fresh adapter or
 * resumed session resolves it without event-only state.
 */
async function projectedAssistant(
  client: ProjectionClient,
  sessionID: string,
  assistantMessageID: string,
): Promise<SessionMessageAssistant | undefined> {
  return walkProjection(client, sessionID, (messages) => {
    for (const message of messages) {
      if (message.id === assistantMessageID && message.type === "assistant") {
        return message as SessionMessageAssistant
      }
    }
    return undefined
  })
}

async function projectedUser(
  client: ProjectionClient,
  sessionID: string,
  messageID: string,
): Promise<SessionMessageUser | undefined> {
  return walkProjection(client, sessionID, (messages) => {
    for (const message of messages) {
      if (message.id === messageID && message.type === "user") {
        return message as SessionMessageUser
      }
    }
    return undefined
  })
}

/**
 * The assistant's real parent user message: the nearest preceding user
 * message in the projection, derived from history so a fresh adapter or
 * resumed session resolves it without event-only state.
 */
async function resolveParentUser(
  client: ProjectionClient,
  sessionID: string,
  assistantMessageID: string,
): Promise<string | undefined> {
  let pastAssistant = false
  return walkProjection(client, sessionID, (messages) => {
    for (const message of messages) {
      if (!pastAssistant) {
        if (message.id === assistantMessageID) pastAssistant = true
        continue
      }
      if (message.type === "user") return message.id
    }
    return undefined
  })
}

export function transcriptFrames(
  transcript: RemoteTranscript,
  directory: string,
  client: ProjectionClient,
  event: TranscriptEvent,
): Effect.Effect<TranscriptFrame[], never, never> {
  return Effect.gen(function* () {
    switch (event.type) {
      case "session.inbox.delivered": {
        const payload = event.data as { inboxID: string; sessionID: string }
        const [session, message] = yield* Effect.promise(() =>
          Promise.all([
            client.session.get({ sessionID: payload.sessionID }).catch(() => undefined),
            projectedUser(client, payload.sessionID, payload.inboxID),
          ]),
        )
        // The v1 user message requires the session's selected agent and model;
        // without either on the session projection the info frame is delayed.
        if (!message || !session?.agent || !session?.model) return []
        const info = optionFrame(decodeUserInfo, {
          id: message.id,
          sessionID: payload.sessionID,
          role: "user",
          time: { created: message.time.created },
          agent: session.agent,
          model: { providerID: session.model.providerID, modelID: session.model.id },
        })
        if (!info) return []
        const frames: TranscriptFrame[] = [frame(payload.sessionID, undefined, "message.updated", { info })]
        const text = optionFrame(decodeTextPart, {
          id: `prt_${message.id}_t0`,
          sessionID: payload.sessionID,
          messageID: message.id,
          type: "text",
          text: message.text,
        })
        if (text) frames.push(frame(payload.sessionID, undefined, "message.part.updated", { part: text }))
        ;(message.files ?? []).forEach((file, index) => {
          const part = optionFrame(decodeFilePart, {
            id: `prt_${message.id}_f${index}`,
            sessionID: payload.sessionID,
            messageID: message.id,
            type: "file",
            mime: file.mime,
            ...(file.name === undefined ? {} : { filename: file.name }),
            url: `data:${file.mime};base64,${file.data}`,
          })
          if (part) frames.push(frame(payload.sessionID, undefined, "message.part.updated", { part }))
        })
        return frames
      }
      case "session.step.started": {
        const payload = event.data as {
          sessionID: string
          assistantMessageID: string
          agent: string
          model: { providerID: string; id: string }
        }
        const parentID = yield* Effect.promise(() =>
          resolveParentUser(client, payload.sessionID, payload.assistantMessageID),
        )
        const worktreeRoot = yield* Effect.promise(() => projectRoot(transcript, client, directory))
        if (parentID === undefined || worktreeRoot === undefined || event.created === undefined) return []
        // The canonical v1 initial assistant message: zero cost and token
        // accounting until the terminal step event reports the real usage
        // (v1 producer precedent, ecccd1f session/prompt.ts ~654-667). The
        // consumer's getMessageIds only grows via upsertMessage, so this
        // early frame is what makes the live parts visible.
        const info = optionFrame(decodeAssistantInfo, {
          id: payload.assistantMessageID,
          sessionID: payload.sessionID,
          role: "assistant",
          time: { created: event.created },
          parentID,
          modelID: payload.model.id,
          providerID: payload.model.providerID,
          mode: payload.agent,
          agent: payload.agent,
          path: { cwd: directory, root: worktreeRoot },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        if (!info) return []
        return [frame(payload.sessionID, undefined, "message.updated", { info })]
      }
      case "session.step.ended": {
        const payload = event.data as {
          sessionID: string
          assistantMessageID: string
          cost: number
          tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          finish?: string
        }
        const projected = yield* Effect.promise(() =>
          projectedAssistant(client, payload.sessionID, payload.assistantMessageID),
        )
        if (!projected) return []
        const parentID = yield* Effect.promise(() =>
          resolveParentUser(client, payload.sessionID, payload.assistantMessageID),
        )
        const worktreeRoot = yield* Effect.promise(() => projectRoot(transcript, client, directory))
        const frames: TranscriptFrame[] = []
        // The info frame requires the projection-derived parent and the
        // location's worktree root; the parts stream regardless (the consumer
        // stores them by message identity).
        if (parentID !== undefined && worktreeRoot !== undefined) {
          const info = optionFrame(decodeAssistantInfo, {
            id: projected.id,
            sessionID: payload.sessionID,
            role: "assistant",
            // The terminal update enriches the early frame with the real
            // usage and the completion time that stops the consumer's
            // streaming view (the event envelope is the fallback
            // observation time).
            time: {
              created: projected.time.created,
              completed: projected.time.completed ?? event.created,
            },
            parentID,
            modelID: projected.model.id,
            providerID: projected.model.providerID,
            mode: projected.agent,
            agent: projected.agent,
            path: { cwd: directory, root: worktreeRoot },
            cost: payload.cost,
            tokens: {
              input: payload.tokens.input,
              output: payload.tokens.output,
              reasoning: payload.tokens.reasoning,
              cache: { read: payload.tokens.cache.read, write: payload.tokens.cache.write },
            },
            ...(payload.finish === undefined ? {} : { finish: payload.finish }),
          })
          if (info) frames.push(frame(payload.sessionID, undefined, "message.updated", { info }))
        }
        // Full-value upserts from the ended projection snapshot, per-kind
        // producer ordinals (independent text and reasoning sequences).
        let textOrdinal = 0
        let reasoningOrdinal = 0
        for (const part of projected.content) {
          if (part.type === "text") {
            const decoded = optionFrame(decodeTextPart, {
              id: `prt_${projected.id}_t${textOrdinal}`,
              sessionID: payload.sessionID,
              messageID: projected.id,
              type: "text",
              text: part.text,
            })
            textOrdinal++
            if (decoded) frames.push(frame(payload.sessionID, undefined, "message.part.updated", { part: decoded }))
            continue
          }
          if (part.type === "reasoning") {
            const decoded = optionFrame(decodeReasoningPart, {
              id: `prt_${projected.id}_r${reasoningOrdinal}`,
              sessionID: payload.sessionID,
              messageID: projected.id,
              type: "reasoning",
              text: part.text,
              time: {
                start: part.time?.created ?? event.created,
                ...(part.time?.completed === undefined ? {} : { end: part.time.completed }),
              },
            })
            reasoningOrdinal++
            if (decoded) frames.push(frame(payload.sessionID, undefined, "message.part.updated", { part: decoded }))
          }
          // Tool parts from the ended snapshot are omitted: the v1 completed
          // state requires a `title` string with no v2 source (the live
          // running/error frames below carry the call instead).
        }
        return frames
      }
      case "session.text.delta": {
        const payload = event.data as { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
        // Live accumulated full-value upsert: idempotent on redelivery, never
        // an append replay.
        const running = accumulate(transcript, `${payload.assistantMessageID}:t${payload.ordinal}`, payload.delta)
        const part = optionFrame(decodeTextPart, {
          id: `prt_${payload.assistantMessageID}_t${payload.ordinal}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "text",
          text: running,
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.reasoning.delta": {
        const payload = event.data as { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
        if (event.created === undefined) return []
        // The v1 reasoning part requires an observed start timestamp: without
        // the event envelope's created time the frame is not emitted.
        const running = accumulate(transcript, `${payload.assistantMessageID}:r${payload.ordinal}`, payload.delta)
        const part = optionFrame(decodeReasoningPart, {
          id: `prt_${payload.assistantMessageID}_r${payload.ordinal}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "reasoning",
          text: running,
          time: { start: event.created },
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.text.ended": {
        const payload = event.data as { sessionID: string; assistantMessageID: string; ordinal: number; text: string }
        settleStreaming(transcript, `${payload.assistantMessageID}:t${payload.ordinal}`)
        const part = optionFrame(decodeTextPart, {
          id: `prt_${payload.assistantMessageID}_t${payload.ordinal}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "text",
          text: payload.text,
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.reasoning.ended": {
        const payload = event.data as { sessionID: string; assistantMessageID: string; ordinal: number; text: string }
        settleStreaming(transcript, `${payload.assistantMessageID}:r${payload.ordinal}`)
        // The v1 reasoning end uses the observed completion time: without the
        // event envelope's created time the end is omitted, never invented.
        const part = optionFrame(decodeReasoningPart, {
          id: `prt_${payload.assistantMessageID}_r${payload.ordinal}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "reasoning",
          text: payload.text,
          time: {
            start: event.created,
            ...(event.created === undefined ? {} : { end: event.created }),
          },
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.tool.input.started": {
        const payload = event.data as { sessionID: string; id: string; name: string }
        rememberToolCall(transcript, payload.sessionID, payload.id, { name: payload.name })
        return []
      }
      case "session.tool.called": {
        const payload = event.data as {
          sessionID: string
          assistantMessageID: string
          id: string
          input: Record<string, unknown>
        }
        const name =
          toolCall(transcript, payload.sessionID, payload.id)?.name ??
          (yield* Effect.promise(() =>
            recoverToolName(client, payload.sessionID, payload.assistantMessageID, payload.id),
          ))
        if (name === undefined) return []
        // The v1 running state requires an observed start timestamp: without
        // the event envelope's created time the frame is not emitted.
        if (event.created === undefined) return []
        rememberToolCall(transcript, payload.sessionID, payload.id, { input: payload.input, start: event.created })
        const part = optionFrame(decodeToolPart, {
          id: `prt_${payload.assistantMessageID}_c${payload.id}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "tool",
          callID: payload.id,
          tool: name,
          state: { status: "running", input: payload.input, time: { start: event.created } },
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.tool.success": {
        const payload = event.data as {
          sessionID: string
          assistantMessageID: string
          id: string
          content: ReadonlyArray<{ type: string; text?: string }>
          metadata?: Record<string, unknown>
        }
        const name =
          toolCall(transcript, payload.sessionID, payload.id)?.name ??
          (yield* Effect.promise(() =>
            recoverToolName(client, payload.sessionID, payload.assistantMessageID, payload.id),
          ))
        if (name === undefined) return []
        const projected = yield* Effect.promise(() =>
          projectedAssistant(client, payload.sessionID, payload.assistantMessageID),
        )
        const projectedPart = projected?.content.find((item) => item.type === "tool" && item.id === payload.id)
        const projectedTool = projectedPart?.type === "tool" ? projectedPart : undefined
        const projectedState = projectedTool?.state
        if (projectedTool === undefined || projectedState?.status !== "completed") return []
        // title: "" is the source-proven v1 registry/prompt convention for
        // tools without a display title (ecccd1f registry.ts:205,
        // session/prompt.ts:731).
        const part = optionFrame(decodeToolPart, {
          id: `prt_${payload.assistantMessageID}_c${payload.id}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "tool",
          callID: payload.id,
          tool: name,
          state: {
            status: "completed",
            input: projectedState.input,
            output: payload.content
              .filter((item) => item.type === "text" && typeof item.text === "string")
              .map((item) => item.text)
              .join("\n"),
            title: "",
            metadata: payload.metadata ?? {},
            time: {
              start: projectedTool.time.created,
              end: projectedTool.time.completed ?? event.created,
            },
          },
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      case "session.tool.failed": {
        const payload = event.data as {
          sessionID: string
          assistantMessageID: string
          id: string
          error: { message?: string }
        }
        const tracked = toolCall(transcript, payload.sessionID, payload.id)
        const name =
          tracked?.name ??
          (yield* Effect.promise(() =>
            recoverToolName(client, payload.sessionID, payload.assistantMessageID, payload.id),
          ))
        if (name === undefined) return []
        const input = tracked?.input
        const start = tracked?.start
        if (input === undefined || start === undefined) return []
        const part = optionFrame(decodeToolPart, {
          id: `prt_${payload.assistantMessageID}_c${payload.id}`,
          sessionID: payload.sessionID,
          messageID: payload.assistantMessageID,
          type: "tool",
          callID: payload.id,
          tool: name,
          state: {
            status: "error",
            input,
            error: payload.error.message ?? "",
            time: { start, end: event.created ?? start },
          },
        })
        if (!part) return []
        return [frame(payload.sessionID, undefined, "message.part.updated", { part })]
      }
      default:
        return []
    }
  }).pipe(Effect.catch(() => Effect.succeed([] as TranscriptFrame[])))
}

async function recoverToolName(
  client: ProjectionClient,
  sessionID: string,
  assistantMessageID: string,
  callID: string,
): Promise<string | undefined> {
  const projected = await projectedAssistant(client, sessionID, assistantMessageID)
  const part = projected?.content.find((item) => item.type === "tool" && item.id === callID)
  return part?.type === "tool" ? part.name : undefined
}
