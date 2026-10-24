import { expect } from "bun:test"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Exit, Fiber } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as ConfigService from "@/config/config"
import { KiloHooks } from "@/kilocode/hooks/hooks"
import { KiloHookTool } from "@/kilocode/hooks/tool"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// PermissionRequest hooks against the real permission service: they race the published prompt and
// can only deny it.

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, ConfigService.node, CrossSpawnSpawner.node, EventV2Bridge.node]),
  ),
)

// Exec form: the hook is a bun script, so no shell quoting is involved.
const exec = (code: string) => ({ type: "command" as const, command: process.execPath, args: ["-e", code] })
const write = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))})`
const deny = (message: string, extra: Record<string, unknown> = {}) => ({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message, ...extra } },
})
// A hook that writes its pid to `file`, waits `ms`, then prints `value`.
const slow = (file: string, ms: number, value: unknown) =>
  exec(
    `require('fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); setTimeout(() => { ${write(value)} }, ${ms})`,
  )

const scratch = () =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "kilo-hooks-permission-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  )

const call = (sessionID: SessionID, dir: string): KiloHooks.Call => ({
  tool: "bash",
  args: { command: "ls" },
  callID: "call_bash",
  sessionID,
  directory: dir,
})

const request = (sessionID: SessionID, review?: KiloHookTool.Review, metadata: Record<string, unknown> = {}) => ({
  sessionID,
  permission: "bash",
  patterns: ["ls"],
  metadata,
  always: ["ls"],
  ruleset: [] as PermissionV1.Ruleset,
  review,
})

const pending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    while (true) {
      const list = yield* permission.list()
      if (list.length >= count) return list
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die(new Error("no prompt")) }))

const exists = (file: string) => Effect.promise(() => Bun.file(file).exists())

const until = (check: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* check)) yield* Effect.sleep("20 millis")
  }).pipe(Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die(new Error("timed out")) }))

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

const pid = (file: string) => Effect.promise(async () => Number(await Bun.file(file).text()))

// Every permission event published while the test runs.
const record = Effect.gen(function* () {
  const seen: { type: string; data: Record<string, unknown> }[] = []
  const off = yield* (yield* EventV2Bridge.Service).listen((event) =>
    Effect.sync(() => {
      if (event.type === Permission.Event.Asked.type || event.type === Permission.Event.Replied.type)
        seen.push({ type: event.type, data: event.data as Record<string, unknown> })
    }),
  )
  yield* Effect.addFinalizer(() => off)
  return seen
})

it.instance(
  "publishes the prompt at once and ignores a hook's allow: only the user settles it",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const marker = path.join(dir, "pid")
      const sessionID = SessionID.make("ses_permission_allow")
      const seen = yield* record
      const hooks: KiloHooks.Hooks = {
        PermissionRequest: [
          {
            matcher: "Bash",
            hooks: [slow(marker, 300, { hookSpecificOutput: { decision: { behavior: "allow" } } })],
          },
        ],
      }
      const permission = yield* Permission.Service
      const fiber = yield* permission
        .ask(request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir))))
        .pipe(Effect.forkScoped)
      const [info] = yield* pending(1)
      if (!info) throw new Error("no prompt")
      // The prompt is out while the hook still runs.
      expect(seen.map((item) => item.type)).toEqual([Permission.Event.Asked.type])
      const hook = yield* pid(marker).pipe(Effect.delay("50 millis"))
      yield* until(Effect.sync(() => !alive(hook)))
      yield* Effect.sleep("100 millis")
      expect((yield* permission.list()).map((item) => item.id)).toEqual([info.id])
      yield* permission.reply({ requestID: info.id, reply: "once", interactive: true })
      expect(yield* Fiber.join(fiber)).toEqual({ manual: true })
    }),
  { git: true },
)

it.instance(
  "denies the call when a hook denies, dismissing the prompt",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const sessionID = SessionID.make("ses_permission_deny")
      const seen = yield* record
      const hooks: KiloHooks.Hooks = { PermissionRequest: [{ hooks: [exec(write(deny("never list")))] }] }
      const permission = yield* Permission.Service
      const exit = yield* permission
        .ask(request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir))))
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(KiloHooks.Denied)
      expect((error as Error).message).toBe("A PermissionRequest hook denied this bash call: never list")
      expect(seen.map((item) => [item.type, item.data.reply])).toEqual([
        [Permission.Event.Asked.type, undefined],
        [Permission.Event.Replied.type, "reject"],
      ])
      expect(yield* permission.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "a user reply that comes first wins and kills the hook",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const marker = path.join(dir, "pid")
      const sessionID = SessionID.make("ses_permission_race")
      const hooks: KiloHooks.Hooks = { PermissionRequest: [{ hooks: [slow(marker, 30_000, deny("too late"))] }] }
      const permission = yield* Permission.Service
      const fiber = yield* permission
        .ask(request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir))))
        .pipe(Effect.forkScoped)
      const [info] = yield* pending(1)
      if (!info) throw new Error("no prompt")
      yield* until(exists(marker))
      const hook = yield* pid(marker).pipe(Effect.delay("50 millis"))
      expect(alive(hook)).toBe(true)
      yield* permission.reply({ requestID: info.id, reply: "once", interactive: true })
      expect(yield* Fiber.join(fiber)).toEqual({ manual: true })
      yield* until(Effect.sync(() => !alive(hook)))
    }),
  { git: true },
)

it.instance(
  "a sibling's always reply settles a prompt whose hook is still running",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const marker = path.join(dir, "pid")
      const hooks: KiloHooks.Hooks = { PermissionRequest: [{ hooks: [slow(marker, 30_000, deny("too late"))] }] }
      const permission = yield* Permission.Service
      const first = SessionID.make("ses_permission_sibling_a")
      const second = SessionID.make("ses_permission_sibling_b")
      const hooked = yield* permission
        .ask(request(first, KiloHookTool.review(hooks, call(first, dir))))
        .pipe(Effect.forkScoped)
      yield* pending(1)
      const sibling = yield* permission.ask(request(second)).pipe(Effect.forkScoped)
      const list = yield* pending(2)
      yield* until(exists(marker))
      const hook = yield* pid(marker).pipe(Effect.delay("50 millis"))
      const other = list.find((item) => item.sessionID === second)
      if (!other) throw new Error("no sibling prompt")
      yield* permission.reply({ requestID: other.id, reply: "always", interactive: true })
      yield* Fiber.join(sibling)
      expect(yield* Fiber.join(hooked)).toEqual({ manual: true })
      expect(yield* permission.list()).toEqual([])
      yield* until(Effect.sync(() => !alive(hook)))
    }),
  { git: true },
)

it.instance(
  "a deny that asks to interrupt rejects the call like a user rejection",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const sessionID = SessionID.make("ses_permission_interrupt")
      const hooks: KiloHooks.Hooks = {
        PermissionRequest: [{ hooks: [exec(write(deny("stop everything", { interrupt: true })))] }],
      }
      const exit = yield* (yield* Permission.Service)
        .ask(request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir))))
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "denies on exit 2 with a deny decision and on a failure with onFailure block, but not on exit 2 alone",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const permission = yield* Permission.Service
      const outcome = (name: string, handler: KiloHooks.Handler) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(`ses_permission_${name}`)
          const hooks: KiloHooks.Hooks = { PermissionRequest: [{ hooks: [handler] }] }
          const fiber = yield* permission
            .ask(request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir))))
            .pipe(Effect.forkScoped)
          const exit = yield* Fiber.await(fiber).pipe(Effect.timeoutOption("3 seconds"))
          if (exit._tag === "Some") return Exit.isFailure(exit.value) ? Cause.squash(exit.value.cause) : "allowed"
          // Still pending: nobody denied it.
          const info = (yield* permission.list()).find((item) => item.sessionID === sessionID)
          if (info) yield* permission.reply({ requestID: info.id, reply: "reject", interactive: true })
          yield* Fiber.await(fiber)
          return "pending"
        })
      const json = yield* outcome("json", exec(`${write(deny("blocked by policy"))}; process.exit(2)`))
      expect(json).toBeInstanceOf(KiloHooks.Denied)
      expect((json as Error).message).toContain("blocked by policy")
      const failed = yield* outcome("failure", { ...exec("process.exit(1)"), onFailure: "block" })
      expect(failed).toBeInstanceOf(KiloHooks.Denied)
      expect((failed as Error).message).toContain("set to block on failure")
      expect(yield* outcome("stderr", exec("process.stderr.write('nope'); process.exit(2)"))).toBe("pending")
    }),
  { git: true },
)

it.instance(
  "a hook can deny a forced PreToolUse ask too",
  () =>
    Effect.gen(function* () {
      const dir = yield* scratch()
      const sessionID = SessionID.make("ses_permission_forced")
      const hooks: KiloHooks.Hooks = { PermissionRequest: [{ hooks: [exec(write(deny("not today")))] }] }
      const exit = yield* (yield* Permission.Service)
        .ask({
          ...request(sessionID, KiloHookTool.review(hooks, call(sessionID, dir)), { hookAsk: true, reason: "risky" }),
          ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(KiloHooks.Denied)
    }),
  { git: true },
)

it.instance(
  "without a review the prompt behaves as before",
  () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_permission_plain")
      const permission = yield* Permission.Service
      expect(KiloHookTool.review({}, call(sessionID, process.cwd()))).toBeUndefined()
      const fiber = yield* permission.ask(request(sessionID)).pipe(Effect.forkScoped)
      const [info] = yield* pending(1)
      if (!info) throw new Error("no prompt")
      yield* permission.reply({ requestID: info.id, reply: "reject", interactive: true })
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)
