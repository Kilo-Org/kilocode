// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import { StringDecoder } from "string_decoder"
import { Cause, Effect, Exit, Fiber, Scope } from "effect"
import { SessionID, PartID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Instance } from "@/kilocode/instance"
import type { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionRetry } from "@/session/retry"
import type { LoopInput } from "@/session/prompt"
import { Flag } from "@opencode-ai/core/flag/flag"
import { PlanFollowup } from "@/kilocode/plan-followup"
import { PlanFile } from "@/kilocode/plan-file"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { environmentDetails } from "@/kilocode/editor-context"
import { Identifier } from "@/id/id"
import { Filesystem } from "@/util/filesystem"
import NATIVE_PLAN_PROMPT from "@/kilocode/session/native-plan-prompt.txt"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryMarker } from "@/kilocode/memory/marker"
import { KilocodeSystemPrompt } from "@/kilocode/system-prompt"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import CODE_SWITCH from "@/session/prompt/code-switch.txt"

import type { NotFoundError } from "@/storage/storage"
import { MessageID } from "@/session/schema"

export namespace KiloSessionPrompt {
  const modes = ["ask", "plan", "architect"]
  type Intake = { cancelled: boolean; fiber?: Fiber.Fiber<unknown, unknown> }
  const intakes = new Map<SessionID, Set<Intake>>()

  export function intake<A, E, R>(sessionID: SessionID, work: Effect.Effect<A, E, R>) {
    return Effect.scoped(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.Scope
          const entry: Intake = { cancelled: false }
          const cleanup = Effect.sync(() => {
            const entries = intakes.get(sessionID)
            entries?.delete(entry)
            if (entries?.size === 0) intakes.delete(sessionID)
          })
          const entries = intakes.get(sessionID) ?? new Set()
          entries.add(entry)
          intakes.set(sessionID, entries)
          const fiber = yield* work.pipe(Effect.ensuring(cleanup), Effect.forkIn(scope, { startImmediately: true }))
          entry.fiber = fiber
          if (entry.cancelled) yield* Fiber.interrupt(fiber)
          return yield* restore(Fiber.join(fiber))
        }),
      ),
    )
  }

  export const abortIntakes = Effect.fn("KiloSessionPrompt.abortIntakes")(function* (sessionID: SessionID) {
    const entries = [...(intakes.get(sessionID) ?? [])]
    yield* Effect.forEach(
      entries,
      (entry) => {
        entry.cancelled = true
        return entry.fiber ? Fiber.interrupt(entry.fiber) : Effect.void
      },
      { concurrency: "unbounded", discard: true },
    )
  })

  export function titleID(sessionID: SessionID) {
    return `title-${sessionID}`
  }

  function mode(name: string) {
    return name.toLowerCase()
  }

  function planning(input: { name: string; options?: Record<string, unknown> }) {
    const id = typeof input.options?.id === "string" ? mode(input.options.id) : undefined
    const name = mode(input.name)
    return id === "architect" || name === "plan" || name === "architect"
  }

  function supportsPlanFollowup() {
    return ["cli", "vscode", "jetbrains"].includes(Flag.KILO_CLIENT)
  }

  /**
   * Determines whether the plan follow-up prompt should be shown.
   * Checks if the plan_exit tool was called in the last assistant turn.
   * Exported so tests can verify the logic independently.
   */
  export function shouldAskPlanFollowup(input: { messages: MessageV2.WithParts[]; abort: AbortSignal }) {
    if (input.abort.aborted) return false
    if (!supportsPlanFollowup()) return false
    const idx = input.messages.findLastIndex((m) => m.info.role === "user")
    return input.messages
      .slice(idx + 1)
      .some((msg) =>
        msg.parts.some((p) => p.type === "tool" && p.tool === "plan_exit" && p.state.status === "completed"),
      )
  }

  /**
   * Checks for plan follow-up and asks the user if needed.
   * Returns "continue" if the loop should continue, "break" otherwise.
   */
  export async function askPlanFollowup(input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    abort: AbortSignal
    question: Pick<Question.Interface, "ask" | "list" | "reject">
  }): Promise<"continue" | "break"> {
    if (!shouldAskPlanFollowup({ messages: input.messages, abort: input.abort })) return "break"
    const ask = Instance.bind(PlanFollowup.ask)
    const action = await ask({
      sessionID: input.sessionID,
      messages: input.messages,
      abort: input.abort,
      // Keep the request in the listener-local Question service so HTTP replies can resolve it.
      question: {
        ask: Instance.bind((request: Parameters<Question.Interface["ask"]>[0]) =>
          Effect.runPromise(input.question.ask(request)),
        ),
        list: Instance.bind(() => Effect.runPromise(input.question.list())),
        reject: Instance.bind((requestID: Parameters<Question.Interface["reject"]>[0]) =>
          Effect.runPromise(input.question.reject(requestID)),
        ),
      },
    })
    return action === "continue" ? "continue" : "break"
  }

  export const cancelTree = Effect.fn("KiloSessionPrompt.cancelTree")(function* (input: {
    sessionID: SessionID
    sessions: Pick<Session.Interface, "children">
    cancel: (sessionID: SessionID) => Effect.Effect<void>
  }) {
    function descendants(sessionID: SessionID): Effect.Effect<SessionID[]> {
      return Effect.gen(function* () {
        const children = yield* input.sessions.children(sessionID)
        const nested = yield* Effect.forEach(children, (child) => descendants(child.id), { concurrency: "unbounded" })
        return [...children.map((child) => child.id), ...nested.flat()]
      })
    }

    const children = yield* descendants(input.sessionID)
    yield* Effect.forEach(
      [input.sessionID, ...children],
      (sessionID) =>
        Effect.gen(function* () {
          yield* KiloSessionPromptQueue.cancel(sessionID)
          PlanFollowup.abort(sessionID)
          yield* abortIntakes(sessionID)
          yield* input.cancel(sessionID)
        }),
      { concurrency: "unbounded", discard: true },
    )
  })

  export const recoverDanglingAssistant = Effect.fn("KiloSessionPrompt.recoverDanglingAssistant")(function* (input: {
    sessionID: SessionID
    status: Pick<SessionStatus.Interface, "get">
    sessions: Pick<Session.Interface, "messages" | "removeMessage">
  }) {
    const state = yield* input.status.get(input.sessionID)
    if (state.type !== "idle") return

    const msgs = yield* input.sessions.messages({ sessionID: input.sessionID, limit: 2 })
    const tail = msgs.at(-1)
    if (!tail || tail.info.role !== "assistant") return
    if (tail.parts.length > 0 || tail.info.finish || tail.info.error) return

    const prev = msgs.at(-2)
    if (!prev || prev.info.role !== "user") return
    if (tail.info.parentID !== prev.info.id) return

    yield* input.sessions.removeMessage({ sessionID: input.sessionID, messageID: tail.info.id })
  })

  export const recoverProviderFinishError = Effect.fn("KiloSessionPrompt.recoverProviderFinishError")(
    function* (input: {
      sessionID: SessionID
      status: Pick<SessionStatus.Interface, "get">
      sessions: Pick<Session.Interface, "messages" | "removeMessage">
    }) {
      const state = yield* input.status.get(input.sessionID)
      if (state.type !== "idle") return

      const msgs = yield* input.sessions.messages({ sessionID: input.sessionID, limit: 2 })
      const tail = msgs.at(-1)
      if (!tail || tail.info.role !== "assistant") return
      if (tail.info.finish !== "error" || tail.info.error) return
      if (!tail.parts.some((part) => part.type === "step-finish" && part.reason === "error")) return

      const prev = msgs.at(-2)
      if (!prev || prev.info.role !== "user") return
      if (tail.info.parentID !== prev.info.id) return

      yield* input.sessions.removeMessage({ sessionID: input.sessionID, messageID: tail.info.id })
    },
  )

  export function guardPermissions(input: {
    agent: { name: string; permission: Permission.Ruleset }
    session: Pick<Session.Info, "permission">
  }) {
    const rules = input.session.permission ?? []
    if (!modes.includes(mode(input.agent.name))) return rules
    return Permission.merge(
      rules,
      input.agent.permission,
      rules.filter((rule) => rule.action === "deny"),
    )
  }

  export function hardPermissions(input: { agent: { name: string; permission: Permission.Ruleset } }) {
    if (!modes.includes(mode(input.agent.name))) return
    return input.agent.permission
  }

  export function mergeToolPermissions(input: { existing: Permission.Ruleset; toggles: Permission.Ruleset }) {
    const names = new Set(input.toggles.map((rule) => rule.permission))
    return [...input.existing.filter((rule) => !names.has(rule.permission)), ...input.toggles]
  }

  export const askPermission = Effect.fn("KiloSessionPrompt.askPermission")(function* (input: {
    permission: Pick<Permission.Interface, "ask">
    agents: Pick<Agent.Interface, "get">
    sessions: Pick<Session.Interface, "get">
    agent: Agent.Info
    session: Session.Info
    request: Omit<Permission.AskInput, "ruleset" | "hardRuleset">
  }) {
    const agent = (yield* input.agents.get(input.agent.name)) ?? input.agent
    const session = yield* input.sessions
      .get(input.session.id)
      .pipe(Effect.catchCause(() => Effect.succeed(input.session)))
    yield* input.permission.ask({
      ...input.request,
      ruleset: Permission.merge(agent.permission, guardPermissions({ agent, session })),
      hardRuleset: hardPermissions({ agent }),
    })
  })

  /**
   * Mutable cache for environment details, keyed by user message ID
   * so it recomputes when a new user message arrives.
   */
  export interface EnvCache {
    block?: string
    user?: string
  }

  export function memoryToolEnabled(input: { ctx: MemoryPaths.Ctx }) {
    return KiloToolRegistry.memoryToolsEnabled({ ctx: input.ctx })
  }

  export function memoryCache(): MemoryMarker.Cache {
    return {}
  }

  // Pin the injected memory block per session. Reading the live index every step/turn
  // (each session digest rewrites it) busts the provider prompt cache for instructions +
  // the whole history. Build once at session start and reuse the same block verbatim,
  // which also excludes this session's own digest from its index.
  type PinnedMemory = { blocks: string[]; enabled: boolean; marker?: MemoryMarker.Info }
  const PINNED_MEMORY_MAX = 512
  const pinnedMemory = new Map<string, PinnedMemory>()

  function writePinnedMemory(sessionID: string, value: PinnedMemory) {
    pinnedMemory.set(sessionID, value)
    if (pinnedMemory.size > PINNED_MEMORY_MAX) {
      const oldest = pinnedMemory.keys().next().value
      if (oldest !== undefined) pinnedMemory.delete(oldest)
    }
  }

  /** Test-only: drop the per-session pinned memory block cache. */
  export function clearPinnedMemory() {
    pinnedMemory.clear()
  }

  // Returns the injected memory blocks only; the caller keeps upstream's env line untouched and appends
  // these. Pinned per session (built once at the first step, reused byte-identically after).
  export const memoryInject = Effect.fn("KiloSessionPrompt.memoryInject")(function* (input: {
    ctx: MemoryPaths.Ctx
    sessionID: SessionID
    record: boolean
    cache: MemoryMarker.Cache
  }) {
    const enabled = yield* memoryToolEnabled({ ctx: input.ctx })
    const verbose =
      input.cache.verbose ??
      (enabled
        ? yield* Effect.tryPromise(() => KiloMemory.status({ ctx: input.ctx })).pipe(
            Effect.map((item) => item.state.verbose),
            // Fail closed: unavailable state must not persist memory snippets.
            Effect.catch(() => Effect.succeed(false)),
          )
        : false)
    const cached = pinnedMemory.get(input.sessionID)
    const built =
      cached?.enabled === enabled
        ? cached
        : yield* KilocodeSystemPrompt.memoryBlocks({
            ctx: input.ctx,
            sessionID: input.sessionID,
            record: input.record,
            enabled,
          }).pipe(
            Effect.map((mem) => ({ blocks: mem.blocks, enabled, marker: mem.marker })),
            Effect.tap((mem) => Effect.sync(() => writePinnedMemory(input.sessionID, mem))),
          )
    MemoryMarker.startup({ marker: built.marker, cache: input.cache, verbose })
    return built.blocks
  })

  export function memoryPart(input: { sessionID: SessionID; message: MessageV2.Assistant; cache: MemoryMarker.Cache }) {
    return MemoryMarker.part(input)
  }

  /**
   * Ephemerally injects dynamic editor context (visible files, open tabs, etc.)
   * into the last user message. Caches the result per user message ID so repeated
   * loop iterations produce byte-identical messages (prompt caching).
   */
  export function injectEditorContext(input: {
    msgs: MessageV2.WithParts[]
    lastUser: MessageV2.User
    sessionID: SessionID
    cache: EnvCache
  }) {
    if (input.cache.user !== input.lastUser.id) {
      const ctx = (() => {
        try {
          return Instance.current
        } catch {
          return undefined
        }
      })()
      input.cache.block = environmentDetails({
        ...input.lastUser.editorContext,
        ...(ctx ? { directory: ctx.directory, worktree: ctx.worktree } : {}),
      })
      input.cache.user = input.lastUser.id
    }
    if (!input.cache.block) return
    const idx = input.msgs.findLastIndex((m) => m.info.role === "user")
    if (idx === -1) return
    input.msgs[idx] = {
      ...input.msgs[idx],
      parts: [
        ...input.msgs[idx].parts,
        {
          id: PartID.make(Identifier.ascending("part")),
          sessionID: input.sessionID,
          messageID: input.msgs[idx].info.id,
          type: "text",
          text: input.cache.block,
          synthetic: true,
        } satisfies MessageV2.TextPart,
      ],
    }
  }

  /**
   * Creates StringDecoder-based helpers for shell stdout/stderr that correctly
   * handle multi-byte UTF-8 characters split across chunks.
   */
  export function createShellDecoders() {
    const stdout = new StringDecoder("utf8")
    const stderr = new StringDecoder("utf8")
    return {
      /** Decode a chunk from the given stream. */
      write(stream: "stdout" | "stderr", chunk: Buffer) {
        return stream === "stdout" ? stdout.write(chunk) : stderr.write(chunk)
      },
      /** Flush any trailing buffered bytes from both decoders. */
      flush() {
        return stdout.end() + stderr.end()
      },
    }
  }

  /**
   * Ensures the plan file directory exists. Pre-checks with `Filesystem.isDir`
   * because `fs.mkdir(recursive: true)` still throws `EEXIST` on Windows
   * OneDrive ReparsePoint directories in some Node versions (kilocode#9755).
   */
  export async function ensurePlanDir(dir: string) {
    if (await Filesystem.isDir(dir)) return
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Injects plan-specific reminders into the user message when using the plan agent.
   * Ensures the plan file directory exists and tells the agent where to write.
   */
  export async function insertPlanReminders(input: {
    agent: { name: string; options?: Record<string, unknown> }
    session: Session.Info
    userMessage: MessageV2.WithParts
    messages?: MessageV2.WithParts[]
  }) {
    if (!planning(input.agent)) return
    const add = (text: string) =>
      input.userMessage.parts.push({
        id: PartID.ascending(),
        messageID: input.userMessage.info.id,
        sessionID: input.userMessage.info.sessionID,
        type: "text",
        text,
        synthetic: true,
      })

    // keep bind(): inside Effect.promise the project context is lost, so Instance.current throws without it
    const ctx = Instance.bind(() => Instance.current)()
    const plan = Session.plan(input.session, ctx)

    if (mode(input.agent.name) === "plan") add(NATIVE_PLAN_PROMPT)

    const file = input.messages ? PlanFile.latest(input.messages) : undefined
    const saved = PlanFile.resolve(file, ctx)
    const target = saved ?? plan
    const time = input.session.time.created
    const dir = path.dirname(target)
    if (!saved || !(await Filesystem.exists(target))) await ensurePlanDir(dir)

    const info = saved
      ? `The current saved plan file is ${target}. Read and edit this file when refining the plan.`
      : `Use any exact plan file path from user or project instructions unchanged. If only a directory is specified, create the plan there; otherwise create it in ${dir}. For generated filenames, use ${time}-<concise-kebab-case-suffix>.md, choosing the suffix from the plan details, for example ${time}-database-cache-plan.md.`
    const body = [
      "## Plan File",
      info,
      "Use the chosen plan path as the main plan file. Do not write or edit other files unless the user explicitly asks and your permissions allow it.",
      "Project/user instructions about plan location (for example plans/ or .plans/) are authorized when permissions allow them; they do not conflict with this reminder. When finalizing, call plan_exit with the path of the plan file you wrote.",
      supportsPlanFollowup()
        ? "When the plan is implementation-ready, write the main plan file and call plan_exit. Do not ask the user to choose between finalizing and refining in chat; the client follow-up after plan_exit asks whether to implement the saved plan or keep refining."
        : 'Before creating or updating the plan file, or calling plan_exit, ask the user to choose exactly one of: "Finalize and save the plan" or "Continue refining". If the user chooses to finalize, write the main plan file, then call plan_exit.',
    ].join("\n")
    add(`<system-reminder>\n${body}\n</system-reminder>`)
  }

  /**
   * Returns the CODE_SWITCH prompt text (plan-to-code transition).
   * Used when switching from plan agent to code agent.
   */
  export const CODE_SWITCH_TEXT = CODE_SWITCH

  /**
   * Determines the close reason for a session turn.
   * Checks for an explicit reason first (e.g. set on error during runLoop),
   * then falls back to inspecting the Effect exit value.
   */
  export function resolveCloseReason(input: {
    sessionID: string
    closeReasons: Map<string, KiloSession.CloseReason>
    exit: Exit.Exit<any, any>
  }): KiloSession.CloseReason {
    const explicit = input.closeReasons.get(input.sessionID)
    input.closeReasons.delete(input.sessionID)
    if (explicit) return explicit
    if (Exit.isFailure(input.exit)) {
      return Cause.hasInterruptsOnly(input.exit.cause) ? "interrupted" : "error"
    }
    return "completed"
  }

  /**
   * Maximum number of compactions attempted within a single turn before we
   * surface an exhaustion error. Three is enough to cover a normal overflow
   * compaction plus a summary-self-overflow retry without spinning forever.
   */
  export const MAX_COMPACTION_ATTEMPTS = 3

  /**
   * Guards a compaction attempt. When the attempt count has already reached
   * `MAX_COMPACTION_ATTEMPTS`, marks the close reason as `"error"`, attaches a
   * `ContextOverflowError` to the assistant message (if provided), and returns
   * `{ exhausted: true }` so callers can break out of the loop. Otherwise
   * returns `{ exhausted: false }`.
   */
  export function guardCompactionAttempt(input: {
    sessionID: string
    attempts: number
    closeReasons: Map<string, KiloSession.CloseReason>
    message?: MessageV2.Assistant
  }) {
    if (input.attempts < MAX_COMPACTION_ATTEMPTS) return { exhausted: false as const }
    const error = new MessageV2.ContextOverflowError({
      message: `Compaction exhausted: context still exceeds model limits after ${MAX_COMPACTION_ATTEMPTS} attempts`,
    }).toObject()
    input.closeReasons.set(input.sessionID, "error")
    if (input.message) {
      // Preserve any pre-existing error/finish the caller already set; only fill in blanks.
      input.message.error ??= error
      input.message.finish ??= "error"
    }
    return { exhausted: true as const, error }
  }

  /**
   * Maximum number of automatic restarts allowed for a stuck main session.
   * Matches the `KILO_MAIN_SESSION_RESTART_LIMIT` flag.
   */
  export const MAX_MAIN_SESSION_RESTARTS = 3

  /**
   * Determines whether a stuck main session should be automatically restarted.
   * Returns `{ exhausted: true }` when the restart limit has been reached,
   * otherwise `{ exhausted: false }`.
   *
   * On exhaustion, the assistant's `error` and `finish` are UNCONDITIONALLY
   * overwritten with the exhaustion signal. The caller always passes an
   * already-errored assistant (guarded by `if (!errored || !errored.error)
   * return` upstream), so the previous `??=` was dead code that left the
   * underlying retryable error (e.g. "internal server error") surfaced
   * instead of the clear "restart limit exhausted" message.
   */
  export function guardMainSessionRestart(input: {
    sessionID: string
    attempts: number
    closeReasons: Map<string, KiloSession.CloseReason>
    message?: MessageV2.Assistant
  }) {
    const limit = Flag.KILO_MAIN_SESSION_RESTART_LIMIT ?? MAX_MAIN_SESSION_RESTARTS
    if (input.attempts <= limit) return { exhausted: false as const }
    input.closeReasons.set(input.sessionID, "error")
    if (input.message) {
      input.message.error = new MessageV2.APIError({
        message: `Main session restart limit (${limit}) exhausted`,
        isRetryable: false,
      }).toObject()
      input.message.finish = "error"
    }
    return { exhausted: true as const }
  }

  /**
   * Removes the terminal-errored assistant tail before a restart.
   * The caller passes the in-memory errored assistant captured by runLoop;
   * removal is by the known message id rather than by re-reading .error from
   * the DB (that re-read is racy and caused the restart decision to be
   * non-deterministic). The DB is only consulted to verify the id is still the
   * answering tail for the current user turn.
   *
   * Returns true if a tail was removed.
   */
  export function recoverTerminalErrorTail(input: {
    sessionID: string
    status: Pick<SessionStatus.Interface, "get">
    sessions: Pick<Session.Interface, "messages" | "removeMessage">
    message?: MessageV2.Assistant
  }): Effect.Effect<boolean, NotFoundError> {
    return Effect.gen(function* () {
      const state = yield* input.status.get(SessionID.make(input.sessionID))
      if (state.type !== "idle") return false

      if (!input.message) return false

      const msgs = yield* input.sessions.messages({ sessionID: SessionID.make(input.sessionID), limit: 2 })
      const tail = msgs.at(-1)
      if (!tail || tail.info.role !== "assistant" || tail.info.id !== input.message.id) return false

      const prev = msgs.at(-2)
      if (!prev || prev.info.role !== "user") return false
      if (tail.info.parentID !== prev.info.id) return false

      yield* input.sessions.removeMessage({
        sessionID: SessionID.make(input.sessionID),
        messageID: MessageID.make(input.message.id),
      })
      return true
    })
  }

  /**
   * Drives a user turn for a (root) main session, including the bounded
   * automatic-restart loop for stuck turns. Extracted from the shared
   * `SessionPrompt.loop` so the upstream file stays thin and the Kilo
   * restart policy (and its concurrency hold, Finding #2) lives in one place.
   *
   * Concurrency: between restart attempts, the per-attempt `state.ensureRunning`
   * call's runner is removed by its `onIdle` (which also flips SessionStatus
   * to idle so the idle-gated `recoverTerminalErrorTail` can run). Without a
   * hold, a concurrent `revert` or HTTP session handler would see `assertNotBusy`
   * pass during the backoff window and race the re-drive. We acquire a
   * reference-counted busy hold on `SessionRunState` for the entire loop and
   * release it only AFTER `publishTurnClose` (so the TurnClose event is
   * observed before any new turn can start). The hold is purely additive:
   * `assertNotBusy` reports busy when EITHER the runner is busy OR the hold
   * count is > 0; non-restart callers never acquire the hold, so their
   * behavior is unchanged. The hold does not interact with the inner
   * `ensureRunning` lifecycle, so it cannot deadlock the runner.
   */
  export const driveMainSessionRestart = Effect.fn("KiloSessionPrompt.driveMainSessionRestart")(function* (input: {
    loopInput: LoopInput
    state: SessionRunState.Interface
    status: Pick<SessionStatus.Interface, "get">
    sessions: Pick<Session.Interface, "get" | "messages" | "removeMessage">
    runLoop: (li: LoopInput) => Effect.Effect<MessageV2.WithParts, NotFoundError>
    lastAssistant: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts, NotFoundError>
    terminalErrors: Map<string, MessageV2.Assistant>
    closeReasons: Map<string, KiloSession.CloseReason>
  }) {
    const session = yield* input.sessions.get(input.loopInput.sessionID)
    let restartAttempts = 0

    yield* KiloSessionPrompt.recoverDanglingAssistant({
      sessionID: input.loopInput.sessionID,
      status: input.status,
      sessions: input.sessions,
    })
    yield* KiloSessionPrompt.recoverProviderFinishError({
      sessionID: input.loopInput.sessionID,
      status: input.status,
      sessions: input.sessions,
    })
    yield* KiloSession.publishTurnOpen({ sessionID: input.loopInput.sessionID })

    // Acquire the busy hold BEFORE the first ensureRunning so that the
    // assertNotBusy gate reports busy for the entire logically in-flight
    // turn, including every backoff window between restart attempts.
    const release = yield* input.state.acquireBusyHold(input.loopInput.sessionID)

    const terminalAssistant = (errored: MessageV2.Assistant, result: MessageV2.WithParts): MessageV2.WithParts => {
      if (result.info.role === "assistant" && result.info.id === errored.id) {
        result.info.error = errored.error
        result.info.finish = errored.finish
        return result
      }
      return { info: errored, parts: [] }
    }

    return yield* Effect.onExit(
      Effect.gen(function* () {
        while (true) {
          yield* KiloSessionPrompt.recoverDanglingAssistant({
            sessionID: input.loopInput.sessionID,
            status: input.status,
            sessions: input.sessions,
          })
          yield* KiloSessionPrompt.recoverProviderFinishError({
            sessionID: input.loopInput.sessionID,
            status: input.status,
            sessions: input.sessions,
          })

          const result = yield* input.state.ensureRunning(
            input.loopInput.sessionID,
            input.lastAssistant(input.loopInput.sessionID).pipe(Effect.orDie),
            input.runLoop(input.loopInput).pipe(Effect.orDie),
          )

          // Capture any terminal error from the just-finished turn using the
          // in-memory message set by runLoop. Never re-read .error from the DB:
          // the persisted error is not reliably visible to the immediate post-turn
          // read, which makes the restart decision flaky.
          const errored = input.terminalErrors.get(input.loopInput.sessionID)

          // If the session has a parent (subagent), never auto-restart — parent-driven behavior only.
          if (session.parentID !== undefined) {
            if (errored) return terminalAssistant(errored, result)
            return yield* input.lastAssistant(input.loopInput.sessionID)
          }

          // Only root sessions restart, and only on a retryable terminal error.
          if (!errored || !errored.error) {
            return result
          }

          const retryable = SessionRetry.retryable(errored.error)
          if (retryable === undefined) {
            return terminalAssistant(errored, result)
          }

          // Check restart limit
          restartAttempts++
          const guard = KiloSessionPrompt.guardMainSessionRestart({
            sessionID: input.loopInput.sessionID,
            attempts: restartAttempts,
            closeReasons: input.closeReasons,
            message: errored,
          })
          if (guard.exhausted) {
            return terminalAssistant(errored, result)
          }

          // Remove the terminal-errored assistant tail before re-driving
          yield* KiloSessionPrompt.recoverTerminalErrorTail({
            sessionID: input.loopInput.sessionID,
            status: input.status,
            sessions: input.sessions,
            message: errored,
          })

          // Back off before restart (hold keeps assertNotBusy busy across this gap)
          const backoff = SessionRetry.delay(restartAttempts)
          yield* Effect.sleep(`${backoff} millis`)

          // Continue to next restart iteration
          continue
        }
      }),
      Effect.fnUntraced(function* (exit) {
        // Publish TurnClose BEFORE releasing the hold so the close event is
        // observed while the session is still busy to assertNotBusy, preventing
        // a concurrent prompt from interleaving its TurnOpen between them.
        yield* KiloSession.publishTurnClose({
          sessionID: input.loopInput.sessionID,
          parentID: session.parentID,
          reason: KiloSessionPrompt.resolveCloseReason({
            sessionID: input.loopInput.sessionID,
            closeReasons: input.closeReasons,
            exit,
          }),
        })
        yield* release
      }),
    )
  })

  /**
   * Returns true when `msgs` contains at least one completed, error-free summary
   * assistant.
   */
  export function hasCompletedSummary(msgs: MessageV2.WithParts[]): boolean {
    return msgs.some((m) => m.info.role === "assistant" && m.info.summary === true && !!m.info.finish && !m.info.error)
  }

  /**
   * Returns a possibly-trimmed copy of `msgs` where everything earlier than the
   * newest completed summary's parent user message is dropped. Idempotent — a
   * second call on the already-trimmed list is a no-op.
   *
   * Complements the shared `MessageV2.filterCompacted`, which only breaks when
   * the summary's parent has a `compaction` part. Manual `/compact` and auto-
   * compactions dispatched against a plain text user produce summaries whose
   * parent is a text user; `filterCompacted` keeps the full pre-summary history
   * in that case, which is how the reference session ended up re-shipping
   * multi-MB base-64 images on every turn.
   *
   * If no completed summary is found, or the summary's parent is absent from
   * `msgs`, `msgs` is returned unchanged.
   */
  export function trimBeforeLastSummary(msgs: MessageV2.WithParts[]): MessageV2.WithParts[] {
    const summary = msgs.reduce<{ msg: MessageV2.WithParts; index: number } | undefined>((latest, msg, index) => {
      const info = msg.info
      if (info.role !== "assistant" || info.summary !== true || !info.finish || info.error) return latest
      if (!latest || KiloSessionMessageOrder.compare(msg, latest.msg, index, latest.index) > 0) return { msg, index }
      return latest
    }, undefined)
    if (!summary) return msgs
    const info = summary.msg.info
    if (info.role !== "assistant") return msgs
    const parentIdx = msgs.findIndex((m) => m.info.id === info.parentID)
    if (parentIdx === -1) return msgs
    return parentIdx === 0 ? msgs : msgs.slice(parentIdx)
  }

  /**
   * Returns a shallow-modified copy of `msgs` where every message before the
   * last real user turn has its media stripped:
   *   - `file` parts with an image/PDF MIME become placeholder `text` parts
   *     (same placeholder shape as `toModelMessagesEffect({ stripMedia: true })`).
   *   - Completed assistant `tool` parts keep their non-media attachments but
   *     drop image/PDF attachments.
   *
   * The cutoff anchors on the newest user message that carries at least one
   * non-synthetic part. Synthetic-only user turns — e.g. the `"Summarize the
   * task tool output above…"` message emitted by `handleSubtask` when a task
   * command continues a turn, or the auto-compaction continue prompt in
   * `compaction.process` — do not count as the current turn, so attachments
   * the user just sent before that handoff are preserved.
   *
   * Media in and after the cutoff is left alone so the model can still
   * analyse attachments the user just sent. Shallow copies only — input is
   * never mutated.
   */
  export function stripHistoricalMedia(msgs: MessageV2.WithParts[]): MessageV2.WithParts[] {
    const cutoff = msgs.findLastIndex(
      (m) => m.info.role === "user" && m.parts.some((p) => p.type !== "text" || !p.synthetic),
    )
    if (cutoff <= 0) return msgs
    return msgs.map((msg, idx) => {
      if (idx >= cutoff) return msg
      const parts = msg.parts.map((part) => {
        if (part.type === "file" && MessageV2.isMedia(part.mime)) {
          return {
            id: part.id,
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "text" as const,
            text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
          } satisfies MessageV2.TextPart
        }
        if (part.type === "tool" && part.state.status === "completed" && part.state.attachments?.length) {
          const kept = part.state.attachments.filter((a) => !MessageV2.isMedia(a.mime))
          if (kept.length === part.state.attachments.length) return part
          return { ...part, state: { ...part.state, attachments: kept } }
        }
        return part
      })
      return { ...msg, parts }
    })
  }

  /**
   * Convenience wrapper: calls `stripHistoricalMedia` only when `msgs` contains
   * a completed summary. Keeps the main-prompt call site to a single line.
   */
  export function maybeStripHistoricalMedia(msgs: MessageV2.WithParts[]): MessageV2.WithParts[] {
    return hasCompletedSummary(msgs) ? stripHistoricalMedia(msgs) : msgs
  }
}
