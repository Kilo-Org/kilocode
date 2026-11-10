export * as KiloBoard from "./index"

import { Config } from "@opencode/core/config"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
import type { ListCursor } from "@opencode/schema/session"
import { SessionID } from "@opencode/schema/session-id"
import { DateTime, Effect, Option, Ref, Schema, Stream } from "effect"
import { BoardContext } from "./context"
import { BoardEnabled } from "./enabled"
import { BoardNotice } from "./notice"
import { BoardStore } from "./store"
import { makeTools } from "./tool"

const decodeSessionID = Schema.decodeUnknownOption(SessionID)

// Kilo Swarm: the shared board of one main session and its subagents. The board_read and board_post tools, the
// board instructions for sessions that have the tools, the activity notice on tool results, and the `kilocode.board`
// RPC for clients.
export const Plugin = define({
  id: "kilocode.board",
  effect: Effect.fn("KiloBoardPlugin")(function* (ctx) {
    // Location services: the supervisor provides them to host plugins, outside the plugin's typed requirements.
    const config = yield* Effect.serviceOption(Config.Service)
    const sessionService = yield* Effect.serviceOption(Session.Service)
    const jobService = yield* Effect.serviceOption(Job.Service)
    if (Option.isNone(config) || Option.isNone(sessionService) || Option.isNone(jobService))
      return yield* Effect.die(new Error("Kilo Swarm requires location services"))
    const sessions = sessionService.value
    const jobs = jobService.value
    const enabled = config.value.entries().pipe(Effect.map(BoardEnabled.on))
    const state = { visible: yield* enabled }
    /** Sessions whose latest model request offered board_read. */
    const exposed = new Set<string>()
    /** Sessions retrying a failed model call, from `session.status`. */
    const retrying = new Set<string>()
    const emit = yield* Ref.make<(event: KiloBoardRpc.Changed) => Effect.Effect<void>>(() => Effect.void)

    const member = (info: Effect.Success<ReturnType<typeof sessions.get>>): BoardStore.Member => ({
      id: info.id,
      ...(info.parentID ? { parentID: info.parentID } : {}),
      projectID: info.projectID,
      directory: info.location.directory,
      ...(info.title === undefined ? {} : { title: info.title }),
      ...(info.agent ? { agent: info.agent } : {}),
      created: DateTime.toEpochMillis(info.time.created),
    })

    const store: BoardStore.Runtime = {
      storage: ctx.storage,
      session: (id) =>
        Option.match(decodeSessionID(id), {
          onNone: () => Effect.succeed(undefined),
          onSome: (sessionID) =>
            sessions.get(sessionID).pipe(
              Effect.map(member),
              Effect.orElseSucceed(() => undefined),
            ),
        }),
      // Every direct child: a family larger than one page must not lose members.
      children: (id) => {
        const parentID = Option.getOrUndefined(decodeSessionID(id))
        if (!parentID) return Effect.succeed([])
        const page = (cursor?: ListCursor): Effect.Effect<BoardStore.Member[]> =>
          sessions.list({ parentID, ...(cursor ? { cursor } : {}) }).pipe(
            Effect.flatMap((result) => {
              const items = result.data.map(member)
              if (!result.cursor.next || result.data.length === 0) return Effect.succeed(items)
              return page(result.cursor.next).pipe(Effect.map((rest) => [...items, ...rest]))
            }),
            Effect.orElseSucceed(() => []),
          )
        return page()
      },
      // A subagent's job has the child session's ID. A running model call (busy) or a retry wins over the job state.
      execution: (ids) =>
        Effect.gen(function* () {
          const active = yield* sessions.active
          const entries = yield* Effect.forEach(ids, (id) =>
            jobs.get(id).pipe(
              Effect.map((job): [string, BoardStore.Execution | undefined] => {
                const updated = job?.started_at
                const timed = updated === undefined ? {} : { updated }
                if (retrying.has(id)) return [id, { state: "retry", ...timed }]
                if (active.has(SessionID.make(id))) return [id, { state: "busy", ...timed }]
                if (job) return [id, { state: job.status, ...timed }]
                return [id, undefined]
              }),
            ),
          )
          return {
            observedAt: Date.now(),
            sessions: new Map(
              entries.flatMap(([id, execution]): [string, BoardStore.Execution][] => (execution ? [[id, execution]] : [])),
            ),
          }
        }),
    }

    const changed = (sessionID: SessionID) =>
      BoardStore.head(store, sessionID).pipe(
        Effect.flatMap((head) =>
          Effect.flatMap(Ref.get(emit), (publish) => publish({ sessionID: head.root, revision: head.revision })),
        ),
        Effect.ignore,
      )

    const registration = yield* ctx.rpc
      .register(KiloBoardRpc.Definition, {
        status: () => enabled.pipe(Effect.map((value) => ({ enabled: value }))),
        get: (input, context) =>
          BoardStore.observe(store, {
            sessionID: input.sessionID,
            directory: ctx.location.directory,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          }).pipe(
            Effect.mapError((error) => context.error(error.kind === "not_found" ? "not_found" : "invalid", error.message)),
          ),
        reset: (input, context) =>
          BoardStore.reset(store, {
            sessionID: input.sessionID,
            directory: ctx.location.directory,
            revision: input.revision,
          }).pipe(
            Effect.tap((board) =>
              Effect.flatMap(Ref.get(emit), (publish) =>
                publish({ sessionID: board.ownerSessionID, revision: board.revision }),
              ),
            ),
            Effect.mapError((error) =>
              error._tag === "BoardStore.Conflict"
                ? context.error("conflict", error.message)
                : context.error(error.kind === "not_found" ? "not_found" : "invalid", error.message),
            ),
          ),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(emit, (event) => registration.events.emit("changed", event).pipe(Effect.ignore))

    const tools = makeTools({
      store,
      enabled,
      permission: { assert: (input) => ctx.permission.assert(input) },
      changed,
    })
    yield* ctx.tool
      .transform((editor) => {
        if (!state.visible) return
        editor.add(tools.read)
        editor.add(tools.post)
      })
      .pipe(Effect.orDie)

    // A flagged tool call keeps its marker in the result metadata and here, by tool call ID: request messages carry
    // the call ID but not the metadata, and the notice reaches the model on every later request, never the transcript.
    const flagged = (sessionID: string) => {
      const prefix = `notice/${sessionID}/`
      const page = (after?: string): Effect.Effect<[string, BoardNotice.Marker][]> =>
        ctx.storage.scan({ prefix, ...(after ? { after } : {}), limit: 1000 }).pipe(
          Effect.flatMap((result) => {
            const items = result.entries.flatMap((entry): [string, BoardNotice.Marker][] =>
              typeof entry.value === "number" || entry.value === "unavailable"
                ? [[entry.key.slice(prefix.length), entry.value]]
                : [],
            )
            if (!result.next) return Effect.succeed(items)
            return page(result.next).pipe(Effect.map((rest) => [...items, ...rest]))
          }),
        )
      return page().pipe(Effect.map((items) => new Map(items)))
    }
    const annotate = (event: { sessionID: string; messages: SessionContext["messages"] }) =>
      flagged(event.sessionID).pipe(Effect.map((markers) => BoardNotice.apply(event.messages, markers)))

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        yield* annotate(event)
        if (!state.visible || !("board_read" in event.tools)) {
          exposed.delete(event.sessionID)
          return
        }
        exposed.add(event.sessionID)
        event.system.push({ type: "text", text: BoardContext.instructions })
      }),
    )
    yield* ctx.session.hook("compaction", annotate)
    yield* ctx.session.hook("generate", annotate)

    const notifier = BoardContext.notifier(store)
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed" || !state.visible || !exposed.has(event.sessionID)) return
        const marker = yield* notifier.notify({ sessionID: event.sessionID, tool: event.tool, result: event.result })
        if (marker === undefined) return
        yield* ctx.storage.set(`notice/${event.sessionID}/${event.id}`, marker)
        event.result = BoardNotice.attach(event.result, marker)
      }),
    )

    yield* ctx.event.subscribe({ types: ["config.updated", "session.status", "session.deleted"] }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "session.status") {
            if (event.data.status.type === "retry") retrying.add(event.data.sessionID)
            else retrying.delete(event.data.sessionID)
            return
          }
          if (event.type === "session.deleted") {
            exposed.delete(event.data.sessionID)
            retrying.delete(event.data.sessionID)
            notifier.forget(event.data.sessionID)
            const markers = yield* flagged(event.data.sessionID)
            yield* Effect.forEach(markers.keys(), (id) => ctx.storage.remove(`notice/${event.data.sessionID}/${id}`), {
              discard: true,
            })
            return
          }
          const next = yield* enabled
          if (next === state.visible) return
          state.visible = next
          yield* ctx.tool.reload()
        }),
      ),
      Effect.ignore,
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
