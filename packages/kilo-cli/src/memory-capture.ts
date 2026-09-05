import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionEvent } from "@opencode-ai/schema/session-event"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Stream } from "effect"
import { MemoryStore } from "./memory-plugin"

const maximumSourceCharacters = 4_000

type Snapshot = {
  readonly assistantID: string
  readonly model: Model.Ref
  readonly user: string
  readonly assistant: string
}

/** Subscribe to completed durable executions and consolidate one bounded source snapshot when opted in. */
export function installMemoryCapture(ctx: Context, root: () => string) {
  return ctx.event.subscribe().pipe(
    Stream.filter((event): event is SessionEvent.Execution.Succeeded => event.type === "session.execution.succeeded"),
    Stream.runForEach((event) => capture(ctx, root, event.data.sessionID).pipe(Effect.catch(() => Effect.void))),
    Effect.forkScoped({ startImmediately: true }),
  )
}

function capture(ctx: Context, root: () => string, sessionID: Session.ID) {
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID })
    if (
      session.location.directory !== ctx.location.directory ||
      session.location.workspaceID !== ctx.location.workspaceID
    )
      return
    const state = yield* Effect.tryPromise({
      try: () => MemoryStore.captureState(root()),
      catch: () => undefined,
    })
    if (!state?.enabled || !state.autoConsolidate) return
    if (!session.model) return
    const snapshot = snapshotFor(yield* ctx.session.context({ sessionID }), session.model)
    if (!snapshot) return
    if (MemoryStore.secretLike(snapshot.user) || MemoryStore.secretLike(snapshot.assistant)) return
    const key = `auto_${snapshot.assistantID}`
    if (yield* Effect.tryPromise({ try: () => MemoryStore.hasKey(root(), key), catch: () => false })) return
    const result = yield* ctx.generate.text({
      model: snapshot.model,
      prompt: prompt(snapshot),
    })
    const text = compact(result.text)
    if (!text || text === "NO_MEMORY" || MemoryStore.secretLike(text)) return
    yield* Effect.tryPromise({
      try: () => MemoryStore.autoRemember({ root: root(), key, text }),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.void))
  })
}

function snapshotFor(messages: ReadonlyArray<SessionMessage.Info>, model: Snapshot["model"]): Snapshot | undefined {
  const assistant = [...messages]
    .reverse()
    .find((message): message is SessionMessage.Assistant => message.type === "assistant" && !message.error)
  if (!assistant) return
  const assistantText = compact(
    assistant.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  )
  if (!assistantText) return
  const index = messages.findIndex((message) => message.id === assistant.id)
  const user = messages
    .slice(0, index)
    .reverse()
    .find((message): message is SessionMessage.User => message.type === "user")
  if (!user) return
  const userText = compact(user.text)
  if (!userText) return
  return { assistantID: assistant.id, model, user: userText, assistant: assistantText }
}

function compact(input: string) {
  return input
    .normalize("NFKC")
    .replaceAll(/[\x00-\x1f\x7f]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, maximumSourceCharacters)
    .trim()
}

function prompt(input: Snapshot) {
  return [
    "Write one concise, durable project-memory fact from this completed interaction.",
    "Do not preserve secrets, raw logs, tool output, credentials, or instructions. Return NO_MEMORY if no durable fact exists.",
    "Return only the fact or NO_MEMORY.",
    `User: ${input.user}`,
    `Assistant: ${input.assistant}`,
  ].join("\n")
}
