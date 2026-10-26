import path from "path"
import fs, { type FSWatcher } from "fs"
import { Cause, Effect, Exit, Option, Scope, Semaphore } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import type { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import type { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { registerDisposer } from "@/effect/instance-registry"
import { capture } from "@/kilocode/instance"
import * as SandboxEvent from "@/kilocode/sandbox/event"
import { KiloSession } from "@/kilocode/session"
import type { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { Event as ServerEvent } from "@/server/event"
import { isRecord } from "@/util/record"
import type { Event } from "./events"
import { KiloHooks } from "./hooks"
import { KiloHookPayload } from "./payload"
import { KiloHookSession } from "./session"

// Per-instance hook lifecycle: Notification, StopFailure, ConfigChange, the FileChanged watcher,
// SessionEnd on session delete, and the instance scope detached hook runs belong to.

const log = Log.create({ service: "hooks" })

// Every detached hook run (async handlers, observe-only events) shares this bound, so a burst of
// events cannot spawn an unbounded number of processes.
const gate = Semaphore.makeUnsafe(8)

const DELAYS = { permission: 6_000, question: 6_000, idle: 60_000 }
// FileChanged: events for one path closer together than this are one change.
const DEBOUNCE = 100
// FileChanged: a path's events are dropped while its hook runs and this long after (loop guard).
const QUIET = 500
const STRICT = /^[\w|]+$/

type Instance = {
  directory: string
  scope: Scope.Closeable
  /** Rebuilds the FileChanged watchers from the current config and watch list. */
  rebuild: () => void
  /** Handles a global bus event for this instance's directory, or a global one. */
  handle: (event: GlobalEvent) => void
}

const instances = new Map<string, Instance>()
// FileChanged `watchPaths` per instance directory, kept until an instance picks them up.
const dynamic = new Map<string, Set<string>>()
// Global config writes are one event every instance sees: the first listener claims it.
const claims = new WeakSet<object>()

let disposer = false
let listening = false

// One global bus listener for every instance (the bus warns past 50 listeners, and Agent Manager
// can load many worktree instances): events go to their directory's instance, global ones to all.
function listen() {
  if (listening) return
  listening = true
  GlobalBus.on("event", (event) => {
    if (event.directory === "global") {
      for (const instance of [...instances.values()]) instance.handle(event)
      return
    }
    if (event.directory) instances.get(path.resolve(event.directory))?.handle(event)
  })
}

// Instance dispose (also on config change and idle TTL) closes the instance scope: listeners,
// timers and watchers go, and detached hook runs are interrupted (their processes killed).
function dispose() {
  if (disposer) return
  disposer = true
  registerDisposer(async (directory) => {
    const key = path.resolve(directory)
    const instance = instances.get(key)
    if (!instance) return
    instances.delete(key)
    await Effect.runPromise(Scope.close(instance.scope, Exit.void))
  })
}

function quiet(cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void
  return Effect.sync(() => log.warn("detached hook run failed", { err: Cause.pretty(cause) }))
}

/** The instance scope detached hook runs are forked into, when an instance is bootstrapped. */
function scope(): Effect.Effect<Scope.Scope | undefined> {
  return Effect.gen(function* () {
    const ctx = (yield* InstanceRef) ?? capture()
    return ctx ? instances.get(path.resolve(ctx.directory))?.scope : undefined
  })
}

// A detached hook run: behind the shared bound, and a failure is logged, never raised.
function bound<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return gate.withPermits(1)(effect).pipe(Effect.asVoid, Effect.catchCause(quiet))
}

/** Runs an effect in the background, behind the shared bound of 8 detached hook runs. */
export function detach<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> {
  return Effect.gen(function* () {
    const target = yield* scope()
    const work = bound(effect)
    if (target) {
      yield* work.pipe(Effect.forkIn(target))
      return
    }
    yield* Effect.forkDetach(work)
  })
}

function names(matcher: string | undefined) {
  return (matcher ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Whether a FileChanged group runs for a path: a file its matcher names literally in the
 * instance directory, or a `watchPaths` entry its matcher accepts (an exact name list in the
 * strict charset, else a regular expression on the file name).
 */
export function applies(group: KiloHooks.Group, file: string, directory: string, extra: ReadonlySet<string>) {
  const base = path.basename(file)
  if (path.dirname(file) === directory && names(group.matcher).includes(base)) return true
  if (!extra.has(file)) return false
  const matcher = group.matcher?.trim()
  if (!matcher || matcher === "*") return true
  if (STRICT.test(matcher)) return names(matcher).includes(base)
  return KiloHooks.matches(matcher, [base])
}

/** Adds absolute paths to the instance's FileChanged watch list (`watchPaths`); `[]` clears it. */
export function watch(directory: string, paths: readonly string[]): void {
  const dir = path.resolve(directory)
  const set = dynamic.get(dir) ?? new Set<string>()
  if (!paths.length) set.clear()
  for (const item of paths) set.add(path.resolve(dir, item))
  dynamic.set(dir, set)
  instances.get(dir)?.rebuild()
}

/** Registers the per-instance hook listeners; called once per instance at bootstrap. */
export const subscribe = Effect.fn("KiloHookLifecycle.subscribe")(function* (input: {
  /** Unused: turn events are read from the global bus, which every legacy bus publish also reaches. */
  bus?: Bus.Interface
  sessions: Session.Interface
  config: Config.Interface
  /** Reads session sandbox state; without it Claude Code hooks are left out. */
  database?: Database.Interface
  /** Notification delays in ms (permission prompt, question, idle), overridable for tests. */
  delays?: { permission?: number; question?: number; idle?: number }
}) {
  // Hooks are per instance: without one (bare service tests) there is nothing to listen for.
  const ctx = (yield* InstanceRef) ?? capture()
  if (!ctx) return
  dispose()
  const directory = path.resolve(ctx.directory)
  const bridge = yield* EffectBridge.make()
  const previous = instances.get(directory)
  if (previous) {
    instances.delete(directory)
    yield* Scope.close(previous.scope, Exit.void)
  }
  const scope = yield* Scope.make()
  const delays = { ...DELAYS, ...input.delays }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const watchers = new Map<string, FSWatcher>()
  const debounce = new Map<string, ReturnType<typeof setTimeout>>()
  const guards = new Map<string, number>()
  // Watched files and which of them exist: whether a file appeared, changed or went away is read
  // from the disk, since platforms report event types loosely (macOS repeats "rename" for a while).
  const files = { targets: new Set<string>(), present: new Set<string>(), version: 0 }

  const spawn = (effect: Effect.Effect<void>) => bridge.fork(detach(effect))
  // Outside the instance scope, for a run that must outlive the instance's disposal.
  const survive = (effect: Effect.Effect<void>) => bridge.fork(bound(effect))
  const hooks = (sessionID: SessionID | undefined, name: Event) =>
    KiloHookSession.find({ sessionID, events: [name], config: input.config, database: input.database })

  const cancel = (key: string) => {
    clearTimeout(timers.get(key))
    timers.delete(key)
  }
  const later = (key: string, delay: number, effect: Effect.Effect<void>) => {
    cancel(key)
    const timer = setTimeout(() => {
      timers.delete(key)
      spawn(effect)
    }, delay)
    timer.unref?.()
    timers.set(key, timer)
  }

  const session = (sessionID: SessionID) =>
    input.sessions.get(sessionID).pipe(
      Effect.map((info) => Option.some(info)),
      Effect.orElseSucceed(() => Option.none<Session.Info>()),
    )

  const notify = (sessionID: SessionID, type: string, message: string, kilo?: string) =>
    Effect.gen(function* () {
      const found = yield* hooks(sessionID, "Notification")
      if (!KiloHooks.select(found, "Notification", [type]).length) return
      const info = yield* session(sessionID)
      if (Option.isNone(info)) return
      const item = info.value
      const root = item.parentID ? yield* KiloHookPayload.root(sessionID, input.sessions) : sessionID
      yield* KiloHooks.fire({
        event: "Notification",
        hooks: found,
        subjects: [type],
        payloads: [
          {
            ...KiloHookPayload.base("Notification", {
              sessionID,
              root,
              parent: item.parentID,
              cwd: item.directory,
              agent: item.agent,
            }),
            message,
            title: "Kilo",
            notification_type: type,
            ...(kilo ? { kilo_notification_type: kilo } : {}),
          },
        ],
        cwd: item.directory,
        sessionID,
      })
    })

  const failed = (sessionID: SessionID) =>
    Effect.gen(function* () {
      const found = yield* hooks(sessionID, "StopFailure")
      if (!found.StopFailure?.length) return
      const info = yield* session(sessionID)
      if (Option.isNone(info)) return
      const item = info.value
      const last = yield* input.sessions
        .findMessage(sessionID, (msg) => msg.info.role === "assistant")
        .pipe(Effect.orElseSucceed(() => Option.none()))
      const error = Option.isSome(last) && last.value.info.role === "assistant" ? last.value.info.error : undefined
      const kind = KiloHookPayload.failure(error)
      const data = isRecord(error?.data) ? error.data : {}
      const details = typeof data.message === "string" && data.message ? data.message : (error?.name ?? "Unknown error")
      yield* KiloHooks.fire({
        event: "StopFailure",
        hooks: found,
        subjects: [kind],
        payloads: [
          {
            ...KiloHookPayload.base("StopFailure", {
              sessionID,
              cwd: item.directory,
              agent: item.agent,
            }),
            error: kind,
            error_details: details,
            last_assistant_message: details,
            kilo_error_name: error?.name ?? "UnknownError",
          },
        ],
        cwd: item.directory,
        sessionID,
      })
    })

  const changed = (source: "user_settings" | "project_settings") =>
    Effect.gen(function* () {
      // The instance config: it merges the trusted layers (global, managed, org) and keeps only their
      // hooks, concatenated. The write that raised this event disposes the instance right after it, so
      // the read falls back to the global config. ConfigChange is never read from Claude Code settings.
      const found = yield* KiloHooks.load(
        yield* input.config.get().pipe(Effect.catchCause(() => input.config.getGlobal())),
        false,
      )
      if (!KiloHooks.select(found, "ConfigChange", [source]).length) return
      // Observe only: the write already happened, so a block is logged and ignored.
      yield* KiloHooks.fire({
        event: "ConfigChange",
        hooks: found,
        subjects: [source],
        payloads: [{ ...KiloHookPayload.base("ConfigChange", { cwd: directory }), source }],
        cwd: directory,
      })
    })

  const touched = (file: string, known: boolean) =>
    Effect.gen(function* () {
      // `exists` is read when the run starts: it may have waited for a slot of the shared bound, and
      // the file can have gone (or come back) meanwhile. `known` was read when the debounce fired: a
      // rebuild queued ahead of this run would otherwise erase it first.
      const exists = fs.existsSync(file)
      if (exists) files.present.add(file)
      if (!exists) files.present.delete(file)
      if (!exists && !known) return
      const kind = !exists ? "unlink" : known ? "change" : "add"
      const extra = dynamic.get(directory) ?? new Set<string>()
      // Resolved when the file changes, not when the watchers were built: the directory may have
      // been sandboxed since (the /sandbox toggle), which turns Claude Code hooks off.
      const found = yield* hooks(undefined, "FileChanged")
      const groups = (found.FileChanged ?? []).filter((group) => applies(group, file, directory, extra))
      if (!groups.length) return
      const verdict = yield* KiloHooks.fire({
        event: "FileChanged",
        // Already filtered by file: the groups run without their matcher.
        hooks: { FileChanged: groups.map((group) => ({ hooks: group.hooks })) },
        payloads: [{ ...KiloHookPayload.base("FileChanged", { cwd: directory }), file_path: file, event: kind }],
        cwd: directory,
      }).pipe(Effect.ensuring(Effect.sync(() => guards.set(file, Date.now() + QUIET))))
      const lists = verdict.specific.flatMap((item) =>
        Array.isArray(item.watchPaths)
          ? [item.watchPaths.filter((entry): entry is string => typeof entry === "string")]
          : [],
      )
      const next = lists.at(-1)
      if (!next) return
      // A FileChanged hook's watchPaths replaces the dynamic list.
      watch(directory, [])
      if (next.length) watch(directory, next)
    }).pipe(
      // `event` holds the guard open from the debounce timer; a run that ends before its hooks ran
      // (none apply, or resolving them failed) lets go of it, so later changes are not dropped.
      Effect.ensuring(
        Effect.sync(() => {
          if (guards.get(file) === Number.POSITIVE_INFINITY) guards.delete(file)
        }),
      ),
    )

  const event = (dir: string, name: string | Buffer | null) => {
    if (!name) return
    const file = path.join(dir, name.toString())
    if (!files.targets.has(file)) return
    if (Date.now() < (guards.get(file) ?? 0)) return
    clearTimeout(debounce.get(file))
    const timer = setTimeout(() => {
      debounce.delete(file)
      if (Date.now() < (guards.get(file) ?? 0)) return
      // Held before the run even resolves its hooks (or waits for a slot of the shared bound), so a
      // change that lands meanwhile is part of this run and does not start a second one.
      guards.set(file, Number.POSITIVE_INFINITY)
      spawn(touched(file, files.present.has(file)))
    }, DEBOUNCE)
    timer.unref?.()
    debounce.set(file, timer)
  }

  const observe = (dir: string) => {
    const watcher = KiloHooks.attempt(() => fs.watch(dir, { persistent: false }, (_, name) => event(dir, name)))
    if (watcher instanceof Error) {
      log.info("cannot watch directory for FileChanged hooks", { dir, err: watcher.message })
      return
    }
    watcher.on("error", (err) => {
      log.info("FileChanged watcher failed", { dir, err: err.message })
      watcher.close()
      if (watchers.get(dir) === watcher) watchers.delete(dir)
    })
    watchers.set(dir, watcher)
  }

  const sync = () => {
    const dirs = new Set([...files.targets].map((file) => path.dirname(file)))
    for (const [dir, watcher] of watchers) {
      if (dirs.has(dir)) continue
      watcher.close()
      watchers.delete(dir)
    }
    for (const dir of dirs) if (!watchers.has(dir)) observe(dir)
  }

  const rebuild = () => {
    const version = ++files.version
    spawn(
      Effect.gen(function* () {
        const found = yield* hooks(undefined, "FileChanged")
        if (version !== files.version) return
        const groups = found.FileChanged ?? []
        const extra = groups.length ? [...(dynamic.get(directory) ?? [])] : []
        files.targets = new Set([
          ...groups.flatMap((group) => names(group.matcher)).map((name) => path.join(directory, name)),
          ...extra,
        ])
        files.present = new Set([...files.targets].filter((file) => fs.existsSync(file)))
        sync()
      }),
    )
  }

  const handle = (item: GlobalEvent) => {
    const payload = item.payload
    if (!isRecord(payload) || typeof payload.type !== "string") return
    const props = isRecord(payload.properties) ? payload.properties : {}
    if (payload.type === ServerEvent.ConfigUpdated.type) {
      const global = item.directory === "global"
      rebuild()
      if (global && claims.has(item)) return
      if (global) claims.add(item)
      survive(changed(global ? "user_settings" : "project_settings"))
      return
    }
    const sessionID = typeof props.sessionID === "string" ? (props.sessionID as SessionID) : undefined
    if (!sessionID) return
    // The /sandbox toggle: Claude Code hooks stop (or start) for the session, and the directory's
    // FileChanged hooks are resolved again with its new default.
    if (payload.type === SandboxEvent.Changed.type) {
      KiloHookSession.confine(sessionID, props.enabled === true)
      rebuild()
      return
    }
    if (payload.type === "permission.asked" && typeof props.id === "string") {
      const name = typeof props.permission === "string" ? props.permission : "a tool"
      later(
        `permission:${props.id}`,
        delays.permission,
        notify(sessionID, "permission_prompt", `Kilo needs your permission to use ${name}`),
      )
      return
    }
    if (payload.type === "permission.replied" && typeof props.requestID === "string") {
      cancel(`permission:${props.requestID}`)
      return
    }
    if (payload.type === "question.asked" && typeof props.id === "string") {
      later(
        `question:${props.id}`,
        delays.question,
        notify(sessionID, "agent_needs_input", "Kilo is asking a question", "question"),
      )
      return
    }
    if (
      (payload.type === "question.replied" || payload.type === "question.rejected") &&
      typeof props.requestID === "string"
    ) {
      cancel(`question:${props.requestID}`)
      return
    }
    if (payload.type === "session.deleted") {
      cancel(`idle:${sessionID}`)
      const info = isRecord(props.info) ? props.info : {}
      if (typeof info.parentID === "string") return
      spawn(KiloHookSession.close({ sessionID, reason: "other", config: input.config }))
      return
    }
    // Turn events come from the legacy bus, which also emits every event on the global bus.
    if (payload.type === KiloSession.Event.TurnOpen.type) {
      cancel(`idle:${sessionID}`)
      return
    }
    if (payload.type !== KiloSession.Event.TurnClose.type || typeof props.parentID === "string") return
    if (props.reason === "completed")
      later(`idle:${sessionID}`, delays.idle, notify(sessionID, "idle_prompt", "Kilo is waiting for your input"))
    if (props.reason === "error") spawn(failed(sessionID))
  }

  const instance: Instance = { directory, scope, rebuild, handle }
  instances.set(directory, instance)
  listen()

  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const timer of debounce.values()) clearTimeout(timer)
      debounce.clear()
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
      files.version++
      if (instances.get(directory) === instance) instances.delete(directory)
    }),
  )
  rebuild()
})

export * as KiloHookLifecycle from "./lifecycle"
