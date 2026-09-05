import type { MemoryPorts } from "@kilocode/kilo-memory/effect/ports"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { MemoryTimers } from "@kilocode/kilo-memory/effect/timers"
import { MemoryTurn } from "@kilocode/kilo-memory/effect/turn"
import { MemoryFiles } from "@kilocode/kilo-memory/store"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionEvent } from "@opencode-ai/schema/session-event"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Snapshot } from "@opencode-ai/schema/snapshot"
import { Effect, Stream } from "effect"
import type { MemoryDiffReader } from "./memory-diff"

const maximumSourceCharacters = 4_000

type Turn = MemoryPorts.TurnView & {
  readonly snapshots?: { readonly start: Snapshot.ID; readonly end: Snapshot.ID }
}

export type MemoryCaptureOptions = {
  /** Host snapshot diff reader; unavailable or failed reads stay omitted from capture evidence. */
  readonly readSnapshotDiff?: MemoryDiffReader
}

export function createMemoryCaptureGate() {
  const roots = new Map<string, Map<string, ReadonlySet<string>>>()
  return {
    open(input: { readonly root: string; readonly sessionID: Session.ID; readonly assistantIDs: readonly string[] }) {
      const sessions = roots.get(input.root) ?? new Map<string, ReadonlySet<string>>()
      sessions.set(input.sessionID, new Set(input.assistantIDs))
      roots.set(input.root, sessions)
    },
    take(input: { readonly root: string; readonly sessionID: Session.ID }) {
      const sessions = roots.get(input.root)
      const assistantIDs = sessions?.get(input.sessionID)
      sessions?.delete(input.sessionID)
      if (sessions?.size === 0) roots.delete(input.root)
      return assistantIDs
    },
    clear(root: string) {
      roots.delete(root)
    },
  }
}

type MemoryCaptureGate = ReturnType<typeof createMemoryCaptureGate>

/** Run the reusable MemoryTurn pipeline at v2's public execution-drain boundary. */
export function installMemoryCapture(
  ctx: Context,
  root: () => string,
  memory: MemoryService.Interface,
  gate = createMemoryCaptureGate(),
  options: MemoryCaptureOptions = {},
) {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const memoryRoot = root()
        gate.clear(memoryRoot)
        MemoryTimers.clear(memoryRoot)
      }),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (
          event,
        ): event is
          | SessionEvent.Execution.Started
          | SessionEvent.Execution.Succeeded
          | SessionEvent.Execution.Failed
          | SessionEvent.Execution.Interrupted =>
          event.type === "session.execution.started" ||
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.failed" ||
          event.type === "session.execution.interrupted",
      ),
      Stream.runForEach((event) => {
        if (event.type === "session.execution.started") {
          return open(ctx, root, gate, event.data.sessionID)
        }
        return capture(
          ctx,
          root,
          memory,
          gate,
          options.readSnapshotDiff,
          event.data.sessionID,
          event.type === "session.execution.succeeded"
            ? "completed"
            : event.type === "session.execution.failed"
              ? "error"
              : "interrupted",
        ).pipe(Effect.catch(() => Effect.void))
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  })
}

function capture(
  ctx: Context,
  root: () => string,
  memory: MemoryService.Interface,
  gate: MemoryCaptureGate,
  readSnapshotDiff: MemoryCaptureOptions["readSnapshotDiff"],
  sessionID: Session.ID,
  reason: MemoryTurn.Reason,
) {
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID })
    if (
      session.location.directory !== ctx.location.directory ||
      session.location.workspaceID !== ctx.location.workspaceID
    )
      return
    const memoryRoot = root()
    const state = yield* Effect.tryPromise({ try: () => MemoryFiles.readState(memoryRoot), catch: () => undefined })
    if (!state?.enabled || !state.autoConsolidate) return
    if (!session.model) return
    const baseline = gate.take({ root: memoryRoot, sessionID })
    if (!baseline) return
    const turns = memoryTurnsSinceBaseline(
      memoryTurnsFor(yield* ctx.session.context({ sessionID }), session.model, reason),
      baseline,
      state.stats.lastConsolidatedMessageID,
    )
    if (!turns.length) return
    for (const turn of turns) {
      const diffs =
        turn.snapshots && readSnapshotDiff
          ? yield* readSnapshotDiff({ sessionID, ...turn.snapshots }).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
          : undefined
      const sessionPort: MemoryPorts.SessionPort = {
        readTurn: () => Effect.succeed(diffs ? { ...turn, diffs: [...diffs] } : turn),
        get: () => Effect.succeed({ ...(session.parentID ? { parentID: session.parentID } : {}) }),
      }
      const modelPort: MemoryPorts.ModelPort = {
        resolve: () => Effect.succeed({ handle: session.model }),
        run: async (input) =>
          Effect.runPromise(
            ctx.generate.text({
              model: input.handle as Model.Ref,
              // The public v2 generation API has one prompt field, so preserve the
              // package's system/prompt separation as explicit labeled text.
              prompt: ["System instructions:", input.system, "", "Input:", input.prompt].join("\n"),
            }),
            { signal: input.signal },
          ).then((result) => ({ text: result.text, usage: undefined })),
      }
      yield* MemoryTurn.close({
        root: memoryRoot,
        sessionID,
        reason,
        session: sessionPort,
        model: modelPort,
      }).pipe(Effect.provideService(MemoryService.Service, memory))
    }
  })
}

function open(ctx: Context, root: () => string, gate: MemoryCaptureGate, sessionID: Session.ID) {
  return Effect.gen(function* () {
    MemoryTurn.open({ sessionID })
    const session = yield* ctx.session.get({ sessionID })
    if (
      session.location.directory !== ctx.location.directory ||
      session.location.workspaceID !== ctx.location.workspaceID
    )
      return
    const memoryRoot = root()
    const state = yield* Effect.tryPromise({ try: () => MemoryFiles.readState(memoryRoot), catch: () => undefined })
    if (!state?.enabled || !state.autoConsolidate || !session.model) return
    gate.open({
      root: memoryRoot,
      sessionID,
      assistantIDs: memoryTurnsFor(yield* ctx.session.context({ sessionID }), session.model).map(
        (turn) => turn.lastAssistantID,
      ),
    })
  })
}

export function memoryTurnsFor(
  messages: ReadonlyArray<SessionMessage.Info>,
  model: Model.Ref,
  reason: MemoryTurn.Reason = "completed",
): Turn[] {
  const groups = messages.reduce<{ users: SessionMessage.User[]; assistants: SessionMessage.Assistant[] }[]>(
    (groups, message) => {
      if (message.type === "user") {
        const current = groups.at(-1)
        if (current && current.assistants.length === 0) {
          current.users.push(message)
          return groups
        }
        groups.push({ users: [message], assistants: [] })
        return groups
      }
      if (message.type === "assistant") groups.at(-1)?.assistants.push(message)
      return groups
    },
    [],
  )
  return groups.flatMap((group) => {
    const assistants = group.assistants.filter((item) => reason !== "completed" || !item.error)
    const first = assistants.at(0)
    const last = assistants.at(-1)
    if (!first || !last) return []
    const user = compact(group.users.map((item) => item.text).join("\n"))
    const assistant = compact(
      assistants
        .flatMap((item) => item.content.filter((part) => part.type === "text").map((part) => part.text))
        .join("\n"),
    )
    if (!user || (!assistant && reason === "completed")) return []
    return {
      user,
      assistant,
      recent: messages
        .slice(Math.max(0, messages.indexOf(group.users[0]!) - 23), messages.indexOf(last) + 1)
        .flatMap((item) => {
          if (item.type === "user") return [`User: ${compact(item.text)}`]
          if (item.type !== "assistant") return []
          const content = compact(
            item.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          )
          return content ? [`Assistant: ${content}`] : []
        })
        .join("\n"),
      lastAssistantID: last.id,
      sessionModel: { providerID: model.providerID, modelID: model.id },
      ...(first.snapshot?.start && last.snapshot?.end
        ? { snapshots: { start: first.snapshot.start, end: last.snapshot.end } }
        : {}),
      recalledMemory: assistants.some((item) =>
        item.content.some(
          (part) =>
            part.type === "tool" &&
            part.name === "kilo_memory_recall" &&
            part.state.status === "completed" &&
            typeof part.state.metadata?.count === "number" &&
            part.state.metadata.count > 0,
        ),
      ),
      // The optional host reader resolves this group's exact snapshot span only after consent filtering.
    } satisfies Turn
  })
}

/** The observed execution baseline authorizes new groups; the persisted marker only deduplicates its exact group. */
export function memoryTurnsAfterMarker(turns: readonly Turn[], marker: string | null) {
  return marker ? turns.filter((turn) => turn.lastAssistantID !== marker) : [...turns]
}

export function memoryTurnsSinceBaseline(turns: readonly Turn[], baseline: ReadonlySet<string>, marker: string | null) {
  const eligible = memoryTurnsAfterMarker(
    turns.filter((turn) => !baseline.has(turn.lastAssistantID)),
    marker,
  )
  return eligible.map((turn, index) => ({
    ...turn,
    recent: eligible
      .slice(Math.max(0, index - 23), index + 1)
      .flatMap((item) => [`User: ${item.user}`, ...(item.assistant ? [`Assistant: ${item.assistant}`] : [])])
      .join("\n"),
  }))
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
