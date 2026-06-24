// kilocode_change - new file
//
// Slow-repo guard for Snapshot.track.
//
// On huge repositories (e.g. 270k+ untracked files in intellij-community)
// the initial `git add --pathspec-from-file=-` staged by the snapshot system
// can take tens of seconds — long enough to wedge the turn before the LLM
// is even called. This wrapper:
//
//   1. Runs the real `track()` in a forked fiber.
//   2. Waits up to `TIMEOUT_MS` for it to complete.
//   3. If it times out AND we have a sessionID to target, either waits
//      silently when the caller selected that product policy, or asks the user:
//        - "Continue with snapshots": keep waiting on this turn; snapshot
//          finishes eventually and undo/redo stays functional. Future turns
//          are fast because the snapshot index is built.
//        - "Disable for this project": interrupt the in-flight snapshot,
//          persist `"snapshot": false` to `.kilo/kilo.json`, and skip. All
//          future sessions on this project load with snapshots off.
//        - Dismissed / no sessionID: interrupt and skip. Mark the active
//          Snapshot.Service guard so later calls through it do not prompt again.
//
// While the snapshot is running, we inject a synthetic text part into the
// live assistant message so the user sees an "Initializing snapshot…" line
// in the chat — the same place bash/edit tool calls render. The part is
// removed when the snapshot finishes, so the chat history stays clean.
//
// Design notes:
//   - `state.asked` is scoped to the active Snapshot.Service closure, not the
//     directory-keyed snapshot state. It suppresses follow-up prompts until a
//     continued snapshot successfully produces a hash.
//   - We do NOT call `Config.update()` when the user picks "Disable" because
//     that finalizer runs `Instance.dispose()` and tears down the live turn.
//     Instead we write the file directly via `KilocodeConfig.updateProjectConfig`
//     without touching the active Config service.
//   - If the user picks "Continue", the fiber keeps running; we just `join` it
//     and return its value. Any error during the in-flight snapshot is logged
//     and swallowed so the turn can proceed.
//
// All of this is Kilo-specific — the upstream snapshot module remains a thin
// shim that calls into here.

import { Duration, Effect, Fiber, Option } from "effect"
import { applyEdits, modify } from "jsonc-parser"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Question } from "@/question"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { PartID as PartIDSchema } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
import { KiloPartLifecycle } from "@/kilocode/session/part-lifecycle"
import { KilocodeConfig } from "@/kilocode/config/config"
import { ConfigParse } from "@/config/parse"
import * as Log from "@opencode-ai/core/util/log"
import { iife } from "@/util/iife"
import { makeRuntime } from "@/effect/run-service"
import type { Config } from "@/config/config"
// Avoid an eager `import { Session }` here: session/index.ts indirectly
// re-exports this module (via Snapshot.Service), so resolving
// `Session.Service` at module load races with our own initialization and
// throws "Cannot access 'Service' before initialization". The session
// runtime is built lazily on first use inside the default hooks.
//
// The type-only import of `MessageV2` above is erased at compile time, so it
// doesn't participate in the runtime cycle — it just lets us type the narrow
// part-API shim below without `as any`.

/**
 * Narrow typed view of the `Session.Service` methods we actually call from
 * `defaultHooks`. Keeping this local instead of importing `Session.Interface`
 * avoids the value-level cycle described above, while still giving us
 * compile-time checking on payload shape. If `Session.Service` ever renames
 * these methods the cast in `sessionRuntime()` below will fail typecheck
 * instead of blowing up at runtime.
 */
interface SessionPartAPI {
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
}

type SessionRuntime = {
  runPromise: <A>(fn: (svc: SessionPartAPI) => Effect.Effect<A>, options?: Effect.RunOptions) => Promise<A>
}

export namespace KiloSnapshotTrack {
  const log = Log.create({ service: "snapshot.track" })

  const duration = (name: string, fallback: number) =>
    iife(() => {
      const raw = process.env[name]
      if (raw) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
      }
      return fallback
    })

  export const TIMEOUT_MS = duration("KILO_SNAPSHOT_TRACK_TIMEOUT_MS", 10_000)
  export const TURN_TIMEOUT_MS = duration("KILO_SNAPSHOT_TURN_TIMEOUT_MS", 120_000)

  // Wire values — also function as i18n keys via `labelKey`/`headerKey`.
  // The backend matches replies on `label`, so the canonical English strings
  // stay stable even when clients render a translated `labelKey` variant.
  export const ANSWER_CONTINUE = "Continue with snapshots"
  export const ANSWER_DISABLE = "Disable for this project"

  /**
   * User-visible progress label injected into the live assistant message
   * while snapshot.track() is running. The leading `{spinner}` placeholder
   * is replaced at publish time with a rotating braille frame — this matches
   * the animated progress indicator that running task/tool parts render
   * elsewhere, without needing a dedicated part renderer in the TUI or
   * the webview.
   *
   * The same label is shown whether the snapshot is just starting or has
   * already blown past the slow-repo timeout; the accompanying dialog
   * carries the "why" for the wait, so the in-chat indicator stays short
   * and stable.
   */
  export const PROGRESS_INITIALIZING = "{spinner} Initializing snapshot…"

  /**
   * Braille spinner frames used to animate the `{spinner}` placeholder.
   * Same set as the other CLI spinners / running task indicators.
   */
  export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

  /** Interval between spinner frame updates, in ms. */
  export const SPINNER_INTERVAL_MS = 120

  /** Replace the `{spinner}` placeholder in `template` with the given frame. */
  export const formatProgress = (template: string, frame: string): string => template.replace("{spinner}", frame)

  /** Guard state shared by one Snapshot.Service scope, outside directory-keyed InstanceState. */
  export interface State {
    /** Skip every future track call through this service once this flips. */
    disabledForSession: boolean
    /** Guard prompt display until a continued snapshot successfully produces a hash. */
    asked: boolean
    /** Identify the invocation that currently owns the slow-repository prompt. */
    owner?: symbol
  }

  export const makeState = (): State => ({
    disabledForSession: false,
    asked: false,
  })

  export const makeStates = () => {
    const states = new Map<string, State>()
    return (directory: string) => {
      const found = states.get(directory)
      if (found) return found
      const state = makeState()
      states.set(directory, state)
      return state
    }
  }

  export interface ProtectInput<A> {
    readonly inner: Effect.Effect<A>
    readonly state: State
    readonly fallback: A
    readonly operation: "track" | "patch"
    readonly timeoutMs?: number
  }

  /**
   * Enforces the turn-facing snapshot availability budget without waiting for
   * cancellation. Snapshot tracking and patching are optional metadata work;
   * once either exceeds this budget, later calls in the same directory bypass
   * the potentially poisoned lock owner for the lifetime of this service.
   */
  export const protect = <A>(input: ProtectInput<A>): Effect.Effect<A> =>
    Effect.gen(function* () {
      if (input.state.disabledForSession) return input.fallback
      const timeoutMs = input.timeoutMs ?? TURN_TIMEOUT_MS
      return yield* Effect.acquireUseRelease(
        Effect.forkDetach(input.inner, { startImmediately: true }),
        (fiber) =>
          Effect.gen(function* () {
            const result = yield* Fiber.join(fiber).pipe(
              Effect.timeoutOption(Duration.millis(timeoutMs)),
              Effect.catchCause((cause) => {
                input.state.disabledForSession = true
                log.error("snapshot turn operation failed; bypassing snapshots for this directory", {
                  cause,
                  operation: input.operation,
                })
                return Effect.succeed(Option.some(input.fallback))
              }),
            )
            if (Option.isSome(result)) return result.value
            input.state.disabledForSession = true
            log.warn("snapshot turn operation exceeded availability budget; bypassing snapshots for this directory", {
              operation: input.operation,
              timeoutMs,
            })
            return input.fallback
          }),
        (fiber) =>
          Effect.sync(() => {
            setTimeout(() => Effect.runFork(Fiber.interrupt(fiber)), 0)
          }),
      )
    })

  /** Answer shape returned by `askUser`. Three-valued because dismiss !== disable. */
  export type Answer = "continue" | "disable" | "dismissed"

  /** Managed callers can retain snapshots without blocking on the interactive warning. */
  export type SnapshotInitialization = "wait"

  /**
   * Hooks injected by the snapshot layer. Split out so the unit tests can
   * substitute fakes without reaching for the real Question/filesystem stack.
   */
  export interface Hooks {
    /** Ask the user. Returns "dismissed" if the question is rejected. */
    readonly ask: (input: { sessionID: SessionID }, signal?: AbortSignal) => Promise<Answer>
    /** Persist `"snapshot": false` to the project config without disposing the instance. */
    readonly persistDisable: () => Promise<void>
    /** Publish the synthetic progress part allocated by the wrapper. */
    readonly startProgress: (input: { handle: ProgressHandle; text: string }, signal?: AbortSignal) => Promise<void>
    /** Update the visible text on the in-flight progress part. */
    readonly updateProgress: (input: { handle: ProgressHandle; text: string }, signal?: AbortSignal) => Promise<void>
    /** Remove the progress part so the chat stays clean once the snapshot is done. */
    readonly endProgress: (input: { handle: ProgressHandle }, signal?: AbortSignal) => Promise<void>
  }

  /** Coordinates and lifecycle state for one synthetic progress part. */
  export type ProgressHandle = {
    readonly sessionID: SessionID
    readonly messageID: MessageID
    readonly partID: PartID
    started: boolean
    ended: boolean
  }

  export interface WrapInput {
    readonly inner: Effect.Effect<string | undefined>
    readonly state: State
    readonly snapshotInitialization?: SnapshotInitialization
    readonly sessionID?: SessionID
    /**
     * When provided, the wrapper injects an in-message "initializing snapshot…"
     * indicator onto this assistant message. Omitted on callers that don't
     * have an assistant message yet (e.g. background refreshes); those skip
     * the indicator and fall back to the silent timeout behaviour.
     */
    readonly messageID?: MessageID
    readonly hooks?: Hooks
    /** Override the 10s default for tests. */
    readonly timeoutMs?: number
    /**
     * Override the 500ms delay before the indicator appears. Tests set a
     * tiny value so the delay is actually observable within a test run.
     */
    readonly progressDelayMs?: number
    /** Override the progress removal timeout for tests. */
    readonly progressCleanupTimeoutMs?: number
  }

  /**
   * Delay in ms before we inject the "Initializing snapshot…" part. Snapshots
   * on normal-sized repos finish well under this, so the chat stays clean
   * without a one-frame flash of the indicator. Big repos blow past this and
   * the user gets a clear in-chat reason for the wait.
   */
  const PROGRESS_DELAY_MS = 500
  const PROGRESS_CLEANUP_TIMEOUT_MS = 1_000
  const PROGRESS_CLEANUP_RETRY_MS = 50
  const PROGRESS_CLEANUP_ATTEMPTS = 3

  /**
   * Runs `inner` with a timeout + slow-repo prompt flow. Returns the snapshot
   * hash on success, undefined on timeout/skip/error.
   */
  export const wrap = (input: WrapInput): Effect.Effect<string | undefined> =>
    Effect.gen(function* () {
      if (input.state.disabledForSession) return undefined

      const hooks = input.hooks ?? defaultHooks
      const timeoutMs = input.timeoutMs ?? TIMEOUT_MS
      const progressDelayMs = input.progressDelayMs ?? PROGRESS_DELAY_MS
      const cleanupTimeoutMs = input.progressCleanupTimeoutMs ?? PROGRESS_CLEANUP_TIMEOUT_MS

      // The progress part is only published when we have both a session and
      // a target message. Background/non-turn callers skip the indicator.
      const handle: ProgressHandle | undefined =
        input.sessionID && input.messageID
          ? {
              sessionID: input.sessionID,
              messageID: input.messageID,
              partID: PartIDSchema.ascending(),
              started: false,
              ended: false,
            }
          : undefined
      const owner = Symbol()
      let cleared = false
      let removal: Promise<void> | undefined
      let reset = false
      let frameIdx = 0

      const nextFrameText = () => {
        const frame = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length]
        frameIdx += 1
        return formatProgress(PROGRESS_INITIALIZING, frame)
      }

      const removeProgress = async (force: boolean) => {
        if (!handle || (cleared && !force)) return
        for (let attempt = 0; attempt < PROGRESS_CLEANUP_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, PROGRESS_CLEANUP_RETRY_MS))
          const ctl = new AbortController()
          const timeout = Promise.withResolvers<false>()
          const timer = setTimeout(() => {
            ctl.abort()
            timeout.resolve(false)
          }, cleanupTimeoutMs)
          const removed = await Promise.race([
            hooks
              .endProgress({ handle }, ctl.signal)
              .then(() => true as const)
              .catch((err) => {
                log.warn("failed to clear snapshot progress part", { err })
                return false as const
              }),
            timeout.promise,
          ])
          clearTimeout(timer)
          if (!removed) continue
          cleared = true
          return
        }
        log.warn("snapshot progress part remained after cleanup retries")
      }

      const settleProgress = async (work: () => Promise<void>, warning: string) => {
        const settled = await work()
          .then(() => true)
          .catch((err) => {
            log.warn(warning, { err })
            return false
          })
        if (handle?.ended) await removeProgress(true)
        return settled
      }

      const clearProgress = () => {
        if (handle) handle.ended = true
        if (!handle?.started || removal) return Effect.void
        return Effect.sync(() => {
          removal = removeProgress(false).finally(() => {
            removal = undefined
          })
        })
      }

      // Delay the "Initializing snapshot…" indicator so fast snapshots never
      // flash a misleading line in the chat. The fiber:
      //   1. Sleeps until the delay expires.
      //   2. Publishes the first spinner frame.
      //   3. Enters an animation loop that advances a frame every
      //      SPINNER_INTERVAL_MS. The loop runs in the same fiber so
      //      interrupting `progressFiber` stops everything.
      const progressFiber = handle
        ? yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Effect.sleep(Duration.millis(Math.min(progressDelayMs, timeoutMs)))
              handle.started = true
              const started = yield* Effect.promise((signal) =>
                settleProgress(
                  () => hooks.startProgress({ handle, text: nextFrameText() }, signal),
                  "failed to publish snapshot progress part",
                ),
              )
              if (!started || handle.ended) return
              while (true) {
                yield* Effect.sleep(Duration.millis(SPINNER_INTERVAL_MS))
                if (handle.ended) return
                const text = nextFrameText()
                yield* Effect.promise((signal) =>
                  settleProgress(
                    () => hooks.updateProgress({ handle, text }, signal),
                    "failed to advance snapshot spinner frame",
                  ),
                )
              }
            }),
          )
        : undefined

      const stopProgress = Effect.gen(function* () {
        if (progressFiber) yield* Fiber.interrupt(progressFiber)
        yield* clearProgress()
      })

      return yield* Effect.acquireUseRelease(
        Effect.forkDetach(input.inner),
        (fiber) => {
          const cancelSnapshot = Fiber.interrupt(fiber).pipe(Effect.forkDetach, Effect.asVoid)
          const cleanup = Effect.gen(function* () {
            yield* stopProgress
            if (input.state.owner !== owner) return
            if (reset) input.state.asked = false
            input.state.owner = undefined
          })
          return Effect.gen(function* () {
            const quick = yield* Fiber.join(fiber).pipe(
              Effect.timeoutOption(Duration.millis(timeoutMs)),
              Effect.catch((err) => {
                log.warn("snapshot track failed", { err })
                return Effect.succeed({ _tag: "Some" as const, value: undefined as string | undefined })
              }),
            )
            if (quick._tag === "Some") return quick.value

            // Timed out. Keep the existing "Initializing snapshot…" indicator
            // animating so the user still sees live progress while the slow-repo
            // dialog is visible. The progress fiber is only torn down once we've
            // decided whether to keep waiting, disable, or skip below.

            // Managed products such as Agent Manager expect concurrent snapshot
            // initialization and cannot stop started turns for an inline question.
            // Retain the snapshot baseline, but wait silently after the threshold.
            if (input.snapshotInitialization === "wait") {
              log.info("snapshot track slow; waiting without question")
              return yield* Fiber.join(fiber).pipe(
                Effect.catch((err) => {
                  log.warn("snapshot track failed while waiting without question", { err })
                  return Effect.succeed(undefined as string | undefined)
                }),
              )
            }

            // Slow path. No target session to prompt against, or we've already
            // prompted through this service scope — skip silently.
            if (!input.sessionID || input.state.asked || input.state.owner) {
              log.warn("snapshot track slow; skipping for this service scope", { timeoutMs })
              if (!input.state.owner) input.state.disabledForSession = true
              yield* cancelSnapshot
              yield* stopProgress
              return undefined
            }
            input.state.asked = true
            input.state.owner = owner

            const sessionID = input.sessionID
            const answer = yield* Effect.promise((signal) => hooks.ask({ sessionID }, signal))

            if (answer === "continue") {
              log.info("user chose to keep waiting for snapshot; joining fiber")
              const finished = yield* Fiber.join(fiber).pipe(
                Effect.catch((err) => {
                  log.warn("snapshot track failed after user continue", { err })
                  return Effect.succeed(undefined as string | undefined)
                }),
              )
              // Reset `asked` only when the snapshot actually succeeded. That way a
              // future slow turn (e.g. a new massive worktree gets added) still
              // surfaces the dialog instead of silently disabling snapshots on a
              // user who just explicitly said "keep them on". If the fiber failed
              // (finished === undefined), we leave `asked` sticky to avoid prompt
              // spam on a repo that repeatedly errors.
              if (finished) reset = true
              return finished
            }

            input.state.disabledForSession = true
            yield* cancelSnapshot
            yield* stopProgress

            if (answer === "disable") {
              log.info("user chose to disable snapshot for this project")
              yield* Effect.promise(() =>
                hooks.persistDisable().catch((err) => {
                  log.error("failed to persist snapshot:false to project config", { err })
                }),
              )
            } else {
              log.info("user dismissed snapshot prompt; disabling for this service scope only")
            }

            return undefined
          }).pipe(Effect.ensuring(cleanup))
        },
        (fiber) => Fiber.interrupt(fiber).pipe(Effect.forkDetach, Effect.asVoid),
      )
    })

  // ── Default hooks (production wiring) ──────────────────────────────────

  const questionRt = makeRuntime(Question.Service, Question.defaultLayer)

  const fsRt = makeRuntime(AppFileSystem.Service, AppFileSystem.defaultLayer)

  // Lazy to break a module-load cycle with @/session/index.ts. The single
  // cast on the `makeRuntime(...)` result narrows the fully generic runtime
  // to the small `SessionPartAPI` surface defined above.
  let cachedSessionRt: SessionRuntime | undefined
  async function sessionRuntime(): Promise<SessionRuntime> {
    if (cachedSessionRt) return cachedSessionRt
    const mod = await import("@/session/session")
    cachedSessionRt = makeRuntime(mod.Session.Service, mod.Session.defaultLayer) as unknown as SessionRuntime
    return cachedSessionRt
  }

  /** Build the synthetic progress part payload so both start/update share one shape. */
  export const progressPart = (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    text: string
  }): MessageV2.TextPart => ({
    id: input.partID,
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "text",
    text: input.text,
    synthetic: true,
    metadata: { [KiloPartLifecycle.key]: "transient" },
  })

  export const defaultHooks: Hooks = {
    async startProgress(input, signal) {
      const rt = await sessionRuntime()
      await rt.runPromise(
        (svc) =>
          svc.updatePart(
            progressPart({
              sessionID: input.handle.sessionID,
              messageID: input.handle.messageID,
              partID: input.handle.partID,
              text: input.text,
            }),
          ),
        { signal },
      )
    },

    async updateProgress(input, signal) {
      const rt = await sessionRuntime()
      await rt.runPromise(
        (svc) =>
          svc.updatePart(
            progressPart({
              sessionID: input.handle.sessionID,
              messageID: input.handle.messageID,
              partID: input.handle.partID,
              text: input.text,
            }),
          ),
        { signal },
      )
    },

    async endProgress(input, signal) {
      const rt = await sessionRuntime()
      await rt.runPromise(
        (svc) =>
          svc.removePart({
            sessionID: input.handle.sessionID,
            messageID: input.handle.messageID,
            partID: input.handle.partID,
          }),
        { signal },
      )
    },

    async ask(input, signal) {
      return questionRt
        .runPromise(
          (svc) =>
            svc.ask({
              sessionID: input.sessionID,
              blocking: true,
              questions: [
                {
                  header: "Snapshot is slow",
                  headerKey: "snapshot.slowRepo.header",
                  question:
                    "It is taking a long time to initialize the snapshot system, likely due to the size of the repository.\n\n" +
                    "Do you want to disable Snapshots for this repository?",
                  questionKey: "snapshot.slowRepo.question",
                  custom: false,
                  options: [
                    {
                      label: ANSWER_CONTINUE,
                      labelKey: "snapshot.slowRepo.answer.continue",
                      description:
                        "Keep waiting for the snapshot to complete. Subsequent turns are fast once the initial snapshot is built.",
                      descriptionKey: "snapshot.slowRepo.answer.continue.description",
                    },
                    {
                      label: ANSWER_DISABLE,
                      labelKey: "snapshot.slowRepo.answer.disable",
                      description:
                        "Turn off Kilo's snapshots for this project. You will lose undo/redo of Kilo file changes, but git still tracks everything.",
                      descriptionKey: "snapshot.slowRepo.answer.disable.description",
                    },
                  ],
                },
              ],
            }),
          { signal },
        )
        .then((answers): Answer => {
          const pick = answers[0]?.[0]
          if (pick === ANSWER_CONTINUE) return "continue"
          if (pick === ANSWER_DISABLE) return "disable"
          return "dismissed"
        })
        .catch((err): Answer => {
          if (!signal?.aborted && !(err instanceof Question.RejectedError)) {
            log.warn("snapshot question failed; treating as dismissed", { err })
          }
          return "dismissed"
        })
    },

    async persistDisable() {
      const directory = await currentDirectory()
      if (!directory) return
      // Every field on Config.Info is Schema.optional(...), so a single-key
      // object is structurally a valid Config.Info — no cast needed.
      const patch: Config.Info = { snapshot: false }
      await fsRt.runPromise((fs) =>
        Effect.gen(function* () {
          yield* KilocodeConfig.updateProjectConfig({
            fs,
            directory: directory.directory,
            worktree: directory.worktree,
            config: patch,
            read: (file) =>
              fs.readFileString(file).pipe(
                Effect.map((s) => s as string | undefined),
                Effect.catch(() => Effect.succeed<string | undefined>(undefined)),
              ),
            parse: (input, file) => ConfigParse.jsonc(input, file) as Config.Info,
            patch: patchTopLevelJsonc,
            writable: (c) => c,
          })
        }),
      )
    },
  }

  /**
   * Minimal JSONC patcher kept local to this module so it does not depend on
   * the (unexported) helper inside `config/config.ts`.
   *
   * This writes each top-level key in `patch` as a single `modify()` edit,
   * which means nested object values are replaced wholesale rather than
   * merged key-by-key. That's fine for the `{ snapshot: false }` payload we
   * currently send, but any future caller that needs deep merging should
   * promote `config/config.ts::patchJsonc` to a shared helper and use that
   * instead. We assert on non-primitive values so a misuse fails loudly in
   * development rather than silently clobbering a user's nested config.
   */
  function patchTopLevelJsonc(input: string, patch: Config.Info): string {
    return Object.entries(patch).reduce((out, [key, value]) => {
      if (value === undefined) return out
      if (value !== null && typeof value === "object") {
        log.warn("patchTopLevelJsonc called with a non-scalar value; nested keys will be replaced wholesale", { key })
      }
      const edits = modify(out, [key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      return applyEdits(out, edits)
    }, input)
  }

  /**
   * Resolve the active instance directory/worktree. Runs via `Instance.current`
   * when available; returns undefined outside of an instance context (e.g. in
   * tests that bypass the runtime).
   */
  async function currentDirectory(): Promise<{ directory: string; worktree?: string } | undefined> {
    const { Instance } = await import("@/kilocode/instance")
    try {
      return { directory: Instance.directory, worktree: Instance.worktree }
    } catch {
      return undefined
    }
  }
}
