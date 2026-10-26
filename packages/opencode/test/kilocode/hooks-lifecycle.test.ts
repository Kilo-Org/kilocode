import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Deferred, Effect, Fiber } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { disposeInstance } from "@/effect/instance-registry"
import { EventV2Bridge } from "@/event-v2-bridge"
import { KiloHooks } from "@/kilocode/hooks/hooks"
import { KiloHookLifecycle } from "@/kilocode/hooks/lifecycle"
import { KiloHookSession } from "@/kilocode/hooks/session"
import { backendSupport } from "@kilocode/sandbox"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxPreference } from "@/kilocode/sandbox/preference"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SessionPrompt } from "@/session/prompt"
import type { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import {
  allow,
  alive,
  exec,
  hooks,
  isolate,
  layer,
  lines,
  project,
  record,
  sleeper,
  temp,
  until,
} from "./hooks-harness"

isolate()

const it = testEffect(layer)

const marker = () => path.join(temp(), "marker.jsonl")

// Lets a detached hook that should not run have had its chance to.
const settle = (ms = 600) => Effect.sleep(`${ms} millis`)

/** Subscribes the hook lifecycle for the current instance, as bootstrap does. */
const subscribe = Effect.fn("test.subscribe")(function* (
  delays: { permission?: number; question?: number; idle?: number } = {},
) {
  yield* KiloHookLifecycle.subscribe({
    sessions: yield* Session.Service,
    config: yield* Config.Service,
    database: yield* Database.Service,
    delays,
  })
})

const boot = Effect.fn("test.boot")(function* () {
  const env = yield* project()
  yield* hooks({})
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Pinned", permission: allow })
  return { ...env, sessions, chat }
})

// Sandbox cases need a sandbox backend on this machine.
const sandboxed = backendSupport({ mode: "deny", allowedHosts: [] }).available ? it.instance : it.instance.skip

/** Writes Claude Code settings in the test home, removed when the test ends. */
const claude = (value: unknown) =>
  Effect.gen(function* () {
    const settings = path.join(Global.Path.home, ".claude", "settings.json")
    fs.mkdirSync(path.dirname(settings), { recursive: true })
    fs.writeFileSync(settings, JSON.stringify({ hooks: value }))
    yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(settings, { force: true })))
  })

/** Marks a root session as started in this process (its SessionStart ran). */
const start = Effect.fn("test.start")(function* (sessionID: SessionID) {
  yield* KiloHookSession.ensure({
    sessionID,
    sessions: yield* Session.Service,
    config: yield* Config.Service,
    database: yield* Database.Service,
    events: yield* EventV2Bridge.Service,
  })
})

describe("SessionEnd", () => {
  it.instance("deleting a started root session runs it once with reason other; a child never does", () =>
    Effect.gen(function* () {
      const { sessions, chat } = yield* boot()
      const file = marker()
      yield* hooks({ SessionEnd: [{ matcher: "other", hooks: [record(file)] }] })
      yield* subscribe()
      yield* start(chat.id)
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      yield* start(child.id)
      yield* sessions.remove(child.id)
      yield* settle()
      expect(lines(file)).toHaveLength(0)
      yield* sessions.remove(chat.id)
      yield* until(() => lines(file).length === 1)
      yield* settle()
      expect(lines(file)).toHaveLength(1)
      expect(lines(file)[0]).toMatchObject({ hook_event_name: "SessionEnd", reason: "other", session_id: chat.id })
    }),
  )

  it.instance("end() stops a slow hook at the 1.5 s budget, kills it, and runs nothing the second time", () =>
    Effect.gen(function* () {
      const { chat } = yield* boot()
      const dir = temp()
      const file = path.join(dir, "pid")
      const runs = path.join(dir, "runs")
      yield* hooks({
        SessionEnd: [
          { hooks: [exec(`require('fs').appendFileSync(${JSON.stringify(runs)}, 'run\\n'); ${sleeper(file, 10)}`)] },
        ],
      })
      yield* start(chat.id)
      const begin = Date.now()
      yield* Effect.promise(() => KiloHookSession.end("other"))
      const took = Date.now() - begin
      expect(took).toBeLessThan(2_500)
      expect(took).toBeGreaterThanOrEqual(1_400)
      const value = Number(fs.readFileSync(file, "utf8"))
      yield* until(() => !alive(value))
      yield* Effect.promise(() => KiloHookSession.end("other"))
      expect(fs.readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1)
    }),
  )

  it.instance("with the time set in the environment, a hook without its own timeout gets that time too", () =>
    Effect.gen(function* () {
      const { chat } = yield* boot()
      const file = path.join(temp(), "done")
      yield* hooks({
        SessionEnd: [
          { hooks: [exec(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(file)}, 'done'), 2000)`)] },
        ],
      })
      yield* start(chat.id)
      process.env.KILO_SESSIONEND_HOOKS_TIMEOUT_MS = "5000"
      yield* Effect.addFinalizer(() => Effect.sync(() => delete process.env.KILO_SESSIONEND_HOOKS_TIMEOUT_MS))
      yield* Effect.promise(() => KiloHookSession.end("other"))
      expect(fs.existsSync(file)).toBe(true)
    }),
  )

  sandboxed("a root session sandboxed after it started does not run Claude Code hooks when deleted", () =>
    Effect.gen(function* () {
      const { sessions, chat, directory } = yield* boot()
      const kilo = marker()
      const outside = marker()
      yield* claude({ SessionEnd: [{ hooks: [record(outside)] }] })
      yield* hooks({ SessionEnd: [{ hooks: [record(kilo)] }] })
      yield* Effect.promise(() => SandboxPreference.write(directory, false))
      yield* subscribe()
      const other = yield* sessions.create({ title: "other", permission: allow })
      yield* start(chat.id)
      yield* start(other.id)
      yield* SandboxPolicy.toggle(chat.id).pipe(
        Effect.provideService(Config.Service, yield* Config.Service),
        Effect.provideService(Database.Service, yield* Database.Service),
      )
      yield* settle(200)
      yield* sessions.remove(chat.id)
      yield* until(() => lines(kilo).length === 1)
      yield* settle()
      expect(lines(outside)).toHaveLength(0)
      // A session that stayed unsandboxed runs both.
      yield* sessions.remove(other.id)
      yield* until(() => lines(kilo).length === 2 && lines(outside).length === 1)
      expect(lines(outside)[0]?.session_id).toBe(other.id)
    }),
  )

  test("the environment time becomes the timeout of hooks without their own", () => {
    const hooks: KiloHooks.Hooks = {
      SessionEnd: [
        {
          hooks: [
            { type: "command", command: "a" },
            { type: "command", command: "b", timeout: 9 },
          ],
        },
      ],
    }
    expect(KiloHookSession.ending(hooks)).toEqual(hooks)
    process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS = "2500"
    expect(KiloHookSession.ending(hooks).SessionEnd?.[0]?.hooks.map((item) => item.timeout)).toEqual([2.5, 9])
    delete process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  })

  test("the budget follows the configured timeouts, the environment overrides and the cap", () => {
    const set = (timeout?: number): KiloHooks.Hooks => ({
      SessionEnd: [{ hooks: [{ type: "command", command: "x", ...(timeout === undefined ? {} : { timeout }) }] }],
    })
    expect(KiloHookSession.budget([set()])).toBe(1_500)
    expect(KiloHookSession.budget([set(5), set(2)])).toBe(5_000)
    expect(KiloHookSession.budget([set(600)])).toBe(60_000)
    expect(KiloHookSession.budget([set(5)], 3_000)).toBe(3_000)
    process.env.KILO_SESSIONEND_HOOKS_TIMEOUT_MS = "250"
    expect(KiloHookSession.budget([set(5)])).toBe(250)
    delete process.env.KILO_SESSIONEND_HOOKS_TIMEOUT_MS
    process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS = "400"
    expect(KiloHookSession.budget([set(5)])).toBe(400)
    delete process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  })
})

describe("StopFailure", () => {
  it.instance("a turn that ends in an API error runs it with the mapped error type; a completed turn does not", () =>
    Effect.gen(function* () {
      const { llm, chat } = yield* boot()
      const file = marker()
      yield* hooks({ StopFailure: [{ hooks: [record(file)] }] })
      yield* subscribe()
      const prompt = yield* SessionPrompt.Service
      yield* llm.text("fine")
      yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello" }] })
      yield* settle()
      expect(lines(file)).toHaveLength(0)
      yield* llm.error(400, { error: { message: "bad request body" } })
      yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "again" }] })
      yield* until(() => lines(file).length === 1)
      expect(lines(file)[0]).toMatchObject({
        hook_event_name: "StopFailure",
        error: "invalid_request",
        kilo_error_name: "APIError",
        session_id: chat.id,
      })
      expect(String(lines(file)[0]?.error_details)).toContain("bad request body")
    }),
  )

  it.instance("its matcher only takes exact error names", () =>
    Effect.gen(function* () {
      const { llm, chat } = yield* boot()
      const file = marker()
      yield* hooks({
        StopFailure: [
          { matcher: "rate_limit|server_error", hooks: [record(file)] },
          { matcher: "invalid.*", hooks: [record(file)] },
        ],
      })
      yield* subscribe()
      const prompt = yield* SessionPrompt.Service
      yield* llm.error(400, { error: { message: "bad request body" } })
      yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello" }] })
      yield* settle(1_000)
      // "invalid.*" is outside StopFailure's exact-name charset, so it is a regular expression.
      expect(lines(file)).toHaveLength(1)
    }),
  )
})

describe("Notification", () => {
  it.instance("a permission prompt left unanswered notifies; one answered in time does not", () =>
    Effect.gen(function* () {
      const { chat } = yield* boot()
      const file = marker()
      yield* hooks({ Notification: [{ matcher: "permission_prompt", hooks: [record(file)] }] })
      yield* subscribe({ permission: 300 })
      const permission = yield* Permission.Service
      const ask = (pattern: string) =>
        permission
          .ask({ sessionID: chat.id, permission: "bash", patterns: [pattern], metadata: {}, always: [], ruleset: [] })
          .pipe(Effect.exit, Effect.forkChild)
      const pending = Effect.fn("test.pending")(function* () {
        const list = yield* permission.list()
        return list.filter((item) => item.sessionID === chat.id)
      })

      const first = yield* ask("ls")
      yield* until(() => lines(file).length === 1, 3_000)
      expect(lines(file)[0]).toMatchObject({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Kilo needs your permission to use bash",
        session_id: chat.id,
      })
      for (const item of yield* pending()) yield* permission.reply({ requestID: item.id, reply: "reject" })
      yield* Fiber.join(first)

      const second = yield* ask("pwd")
      yield* Effect.gen(function* () {
        while (!(yield* pending()).length) yield* Effect.sleep("5 millis")
      })
      for (const item of yield* pending()) yield* permission.reply({ requestID: item.id, reply: "reject" })
      yield* Fiber.join(second)
      yield* settle()
      expect(lines(file)).toHaveLength(1)
    }),
  )

  it.instance("an unanswered question notifies as agent_needs_input", () =>
    Effect.gen(function* () {
      const { chat } = yield* boot()
      const file = marker()
      yield* hooks({ Notification: [{ hooks: [record(file)] }] })
      yield* subscribe({ question: 100 })
      const question = yield* Question.Service
      const fiber = yield* question
        .ask({
          sessionID: chat.id,
          questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
        })
        .pipe(Effect.exit, Effect.forkChild)
      yield* until(() => lines(file).length === 1, 3_000)
      expect(lines(file)[0]).toMatchObject({
        notification_type: "agent_needs_input",
        kilo_notification_type: "question",
        message: "Kilo is asking a question",
      })
      for (const item of yield* question.list()) yield* question.reject(item.id)
      yield* Fiber.join(fiber)
    }),
  )

  it.instance("an idle session after a completed turn notifies as idle_prompt", () =>
    Effect.gen(function* () {
      const { llm, chat } = yield* boot()
      const file = marker()
      yield* hooks({ Notification: [{ matcher: "idle_prompt", hooks: [record(file)] }] })
      yield* subscribe({ idle: 100 })
      const prompt = yield* SessionPrompt.Service
      yield* llm.text("done")
      yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello" }] })
      yield* until(() => lines(file).length === 1, 3_000)
      expect(lines(file)[0]).toMatchObject({
        notification_type: "idle_prompt",
        message: "Kilo is waiting for your input",
      })
    }),
  )
})

describe("ConfigChange", () => {
  it.instance("a global write with two loaded instances runs it once; a project write runs it for that instance", () =>
    Effect.gen(function* () {
      yield* boot()
      const file = marker()
      const outside = marker()
      yield* claude({ ConfigChange: [{ hooks: [record(outside)] }] })
      yield* hooks({ ConfigChange: [{ hooks: [record(file)] }] })
      yield* subscribe()
      const second = yield* tmpdirScoped({ git: true })
      yield* subscribe().pipe(provideInstanceEffect(second))
      const config = yield* Config.Service
      yield* config.updateGlobal({ autoupdate: false }, { dispose: false })
      yield* until(() => lines(file).length === 1)
      yield* settle()
      expect(lines(file).map((item) => item.source)).toEqual(["user_settings"])
      yield* config.update({ autoshare: false } as Config.Info)
      yield* until(() => lines(file).length === 2)
      yield* settle()
      expect(lines(file).map((item) => item.source)).toEqual(["user_settings", "project_settings"])
      // ConfigChange is never read from Claude Code settings.
      expect(lines(outside)).toHaveLength(0)
      expect((yield* Effect.promise(() => KiloHooks.inspect(Global.Path.home))).skipped).toContainEqual({
        event: "ConfigChange",
        reason: "Kilo config only",
      })
    }),
  )
})

describe("ConfigChange and instance disposal", () => {
  it.instance("a global write that disposes the instance right after still runs it, once", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      // Slow enough to still be running when the instance goes away.
      const slow = exec(
        `const fs=require('fs');const input=fs.readFileSync(0,'utf8');setTimeout(()=>fs.appendFileSync(${JSON.stringify(file)},input.trim()+'\\n'),300)`,
      )
      yield* hooks({ ConfigChange: [{ hooks: [slow] }] })
      yield* subscribe()
      // What PATCH /global/config does: write, then dispose the instances.
      yield* (yield* Config.Service).updateGlobal({ autoupdate: false }, { dispose: false })
      yield* Effect.promise(() => disposeInstance(directory))
      yield* until(() => lines(file).length === 1)
      yield* settle()
      expect(lines(file).map((item) => item.source)).toEqual(["user_settings"])
    }),
  )

  it.instance("a global write that disposes the instance still runs the managed and the global hooks, once each", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const other = marker()
      // Trusted layers other than the global config files: the managed config directory.
      const managed = temp()
      fs.writeFileSync(
        path.join(managed, "kilo.json"),
        JSON.stringify({ hooks: { ConfigChange: [{ hooks: [record(file)] }] } }),
      )
      const previous = process.env.KILO_TEST_MANAGED_CONFIG_DIR
      process.env.KILO_TEST_MANAGED_CONFIG_DIR = managed
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
          else process.env.KILO_TEST_MANAGED_CONFIG_DIR = previous
          fs.rmSync(managed, { recursive: true, force: true })
        }),
      )
      yield* hooks({ ConfigChange: [{ hooks: [record(other)] }] })
      yield* subscribe()
      yield* (yield* Config.Service).updateGlobal({ autoupdate: false }, { dispose: false })
      yield* Effect.promise(() => disposeInstance(directory))
      yield* until(() => lines(file).length === 1 && lines(other).length === 1)
      yield* settle()
      expect(lines(file).map((item) => item.source)).toEqual(["user_settings"])
      expect(lines(other).map((item) => item.source)).toEqual(["user_settings"])
    }),
  )
})

describe("FileChanged", () => {
  it.instance("watches the files its matcher names: add, then change; another listed file changes", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const env = path.join(directory, ".env")
      const envrc = path.join(directory, ".envrc")
      fs.writeFileSync(env, "A=1\n")
      yield* hooks({ FileChanged: [{ matcher: ".envrc|.env", hooks: [record(file)] }] })
      yield* subscribe()
      yield* settle(400)
      fs.writeFileSync(envrc, "export A=1\n")
      yield* until(() => lines(file).length === 1)
      expect(lines(file)[0]).toMatchObject({ hook_event_name: "FileChanged", file_path: envrc, event: "add" })
      expect(lines(file)[0]?.session_id).toBeUndefined()
      yield* settle(700)
      fs.appendFileSync(envrc, "export B=2\n")
      yield* until(() => lines(file).length === 2)
      expect(lines(file)[1]).toMatchObject({ file_path: envrc, event: "change" })
      yield* settle(700)
      fs.appendFileSync(env, "B=2\n")
      yield* until(() => lines(file).length === 3)
      expect(lines(file)[2]).toMatchObject({ file_path: env, event: "change" })
      yield* settle(700)
      fs.rmSync(envrc)
      yield* until(() => lines(file).length === 4)
      expect(lines(file)[3]).toMatchObject({ file_path: envrc, event: "unlink" })
    }),
  )

  it.instance("a hook that rewrites its own file runs at most twice", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const target = path.join(directory, "VERSION")
      fs.writeFileSync(target, "1\n")
      yield* hooks({
        FileChanged: [
          {
            matcher: "VERSION",
            hooks: [record(file, `require('fs').appendFileSync(${JSON.stringify(target)}, 'touched\\n')`)],
          },
        ],
      })
      yield* subscribe()
      yield* settle(400)
      fs.appendFileSync(target, "2\n")
      yield* until(() => lines(file).length >= 1)
      yield* settle(2_000)
      expect(lines(file).length).toBeLessThanOrEqual(2)
    }),
  )

  it.instance("a second change while the hooks are being resolved is part of the same run", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const target = path.join(directory, ".envrc")
      fs.writeFileSync(target, "export A=1\n")
      yield* hooks({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      const config = yield* Config.Service
      const slow = { on: false }
      yield* KiloHookLifecycle.subscribe({
        sessions: yield* Session.Service,
        // The real config, read slowly once armed: resolving the hooks is the window under test.
        config: {
          ...config,
          get: () => (slow.on ? Effect.sleep("600 millis").pipe(Effect.andThen(config.get())) : config.get()),
        },
        database: yield* Database.Service,
      })
      yield* settle(400)
      slow.on = true
      fs.appendFileSync(target, "export B=2\n")
      // 100 ms of debounce, then 600 ms of resolution: this lands in the middle of it.
      yield* settle(400)
      fs.appendFileSync(target, "export C=3\n")
      yield* until(() => lines(file).length >= 1)
      yield* settle(1_500)
      expect(lines(file)).toHaveLength(1)
      expect(lines(file)[0]).toMatchObject({ file_path: target, event: "change" })
    }),
  )

  it.instance("a second change while the run waits for a slot of the shared bound is part of the same run", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const target = path.join(directory, ".envrc")
      fs.writeFileSync(target, "export A=1\n")
      yield* hooks({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      yield* subscribe()
      yield* settle(400)
      // Every slot of the shared bound is taken, so the run queues behind these.
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      for (let i = 0; i < 8; i++) yield* KiloHookLifecycle.detach(Deferred.await(release))
      yield* settle(100)
      fs.appendFileSync(target, "export B=2\n")
      yield* settle(400)
      fs.appendFileSync(target, "export C=3\n")
      yield* settle(400)
      expect(lines(file)).toHaveLength(0)
      yield* Deferred.succeed(release, undefined)
      yield* until(() => lines(file).length >= 1)
      yield* settle(1_000)
      expect(lines(file)).toHaveLength(1)
    }),
  )

  it.instance("a run that waited for a slot reports the file as it is then, and a later recreate is an add", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const target = path.join(directory, ".envrc")
      fs.writeFileSync(target, "export A=1\n")
      yield* hooks({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      yield* subscribe()
      yield* settle(400)
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      for (let i = 0; i < 8; i++) yield* KiloHookLifecycle.detach(Deferred.await(release))
      yield* settle(100)
      fs.appendFileSync(target, "export B=2\n")
      yield* settle(400)
      // Dropped by the guard while the run is queued: the run itself reads the disk when it starts.
      fs.rmSync(target)
      yield* settle(400)
      yield* Deferred.succeed(release, undefined)
      yield* until(() => lines(file).length === 1)
      expect(lines(file)[0]).toMatchObject({ file_path: target, event: "unlink" })
      yield* settle(700)
      fs.writeFileSync(target, "export A=1\n")
      yield* until(() => lines(file).length === 2)
      expect(lines(file)[1]).toMatchObject({ file_path: target, event: "add" })
    }),
  )

  it.instance("a run whose hooks no longer apply lets go of the guard, so the next change is seen", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const target = path.join(directory, ".envrc")
      fs.writeFileSync(target, "export A=1\n")
      yield* hooks({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      yield* subscribe()
      yield* settle(400)
      // The hooks go away without the watchers being rebuilt: the change resolves to no hooks.
      yield* hooks({})
      fs.appendFileSync(target, "export B=2\n")
      yield* settle(700)
      expect(lines(file)).toHaveLength(0)
      // The hook is back, still without a rebuild: a guard left behind would drop this change.
      yield* hooks({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      fs.appendFileSync(target, "export C=3\n")
      yield* until(() => lines(file).length === 1)
    }),
  )

  it.instance("watchPaths add files outside the project, filtered by the matcher", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const outside = temp()
      const watched = path.join(outside, "config.yml")
      const ignored = path.join(outside, "notes.md")
      fs.writeFileSync(watched, "a: 1\n")
      fs.writeFileSync(ignored, "notes\n")
      yield* hooks({ FileChanged: [{ matcher: "config\\.yml", hooks: [record(file)] }] })
      yield* subscribe()
      KiloHookLifecycle.watch(directory, [watched, ignored])
      yield* settle(400)
      fs.appendFileSync(ignored, "more\n")
      fs.appendFileSync(watched, "b: 2\n")
      yield* until(() => lines(file).length === 1)
      yield* settle()
      expect(lines(file).map((item) => item.file_path)).toEqual([watched])
      KiloHookLifecycle.watch(directory, [])
    }),
  )

  sandboxed("Claude Code FileChanged hooks stop once the /sandbox preference sandboxes the directory", () =>
    Effect.gen(function* () {
      const { directory } = yield* boot()
      const file = marker()
      const envrc = path.join(directory, ".envrc")
      fs.writeFileSync(envrc, "export A=1\n")
      yield* claude({ FileChanged: [{ matcher: ".envrc", hooks: [record(file)] }] })
      yield* Effect.promise(() => SandboxPreference.write(directory, false))
      yield* subscribe()
      yield* settle(400)
      fs.appendFileSync(envrc, "export B=2\n")
      yield* until(() => lines(file).length === 1)

      // What the /sandbox toggle writes; the watchers stay as they are.
      yield* Effect.promise(() => SandboxPreference.write(directory, true))
      yield* settle(700)
      fs.appendFileSync(envrc, "export C=3\n")
      yield* settle(1_000)
      expect(lines(file)).toHaveLength(1)
    }),
  )

  test("a group runs for a file its matcher names in the project, or a watched path it accepts", () => {
    const dir = "/repo"
    const extra = new Set(["/elsewhere/config.yml", "/elsewhere/a_b"])
    const group = (matcher?: string) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [] })
    expect(KiloHookLifecycle.applies(group(".envrc|.env"), "/repo/.env", dir, extra)).toBe(true)
    // Names are literal in the project: ".env" is not a pattern that also matches ".envrc".
    expect(KiloHookLifecycle.applies(group(".env"), "/repo/.envrc", dir, extra)).toBe(false)
    expect(KiloHookLifecycle.applies(group(".env"), "/repo/sub/.env", dir, extra)).toBe(false)
    expect(KiloHookLifecycle.applies(group(undefined), "/elsewhere/config.yml", dir, extra)).toBe(true)
    expect(KiloHookLifecycle.applies(group("a_b|c"), "/elsewhere/a_b", dir, extra)).toBe(true)
    expect(KiloHookLifecycle.applies(group("config\\.yml"), "/elsewhere/config.yml", dir, extra)).toBe(true)
    expect(KiloHookLifecycle.applies(group("other"), "/elsewhere/config.yml", dir, extra)).toBe(false)
    expect(KiloHookLifecycle.applies(group(undefined), "/repo/.env", dir, extra)).toBe(false)
  })
})

describe("detached runs", () => {
  it.instance("instance dispose kills a detached hook run", () =>
    Effect.gen(function* () {
      yield* boot()
      const second = yield* tmpdirScoped({ git: true })
      const file = path.join(temp(), "pid")
      yield* subscribe().pipe(provideInstanceEffect(second))
      yield* KiloHookLifecycle.detach(
        KiloHooks.fire({
          event: "Notification",
          hooks: { Notification: [{ hooks: [exec(sleeper(file, 30))] }] },
          payloads: [{}],
          cwd: second,
        }),
      ).pipe(provideInstanceEffect(second))
      yield* until(() => fs.existsSync(file))
      const value = Number(fs.readFileSync(file, "utf8"))
      expect(alive(value)).toBe(true)
      const { disposeInstance } = yield* Effect.promise(() => import("@/effect/instance-registry"))
      yield* Effect.promise(() => disposeInstance(second))
      yield* until(() => !alive(value))
    }),
  )
})
