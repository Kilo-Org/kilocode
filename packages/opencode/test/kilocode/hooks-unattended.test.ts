import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { InstanceStore } from "@/project/instance-store"
import * as MCP from "@/mcp"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { Storage } from "@/storage/storage"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalState } from "@/kilocode/session/goal/state"
import { SessionDrain } from "@/kilocode/session/drain"
import { Wakeup } from "@/kilocode/wakeup"
import { deliver, fireLayer } from "@/kilocode/wakeup/resume"
import { Fire } from "@/kilocode/wakeup/schema"
import { KiloHookUnattended } from "@/kilocode/hooks/unattended"
import type { KiloHooks } from "@/kilocode/hooks/hooks"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect, testEffectShared } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      SessionRunState.node,
      SessionDrain.node,
      Agent.node,
      MCP.node,
      BackgroundJob.node,
      Command.node,
      EventV2Bridge.node,
      Permission.node,
      Question.node,
      FSUtil.node,
      Wakeup.node,
      Storage.node,
      Config.node,
      Database.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

// The production wakeup fire resolves its services from the application runtime; building these
// through the shared memo map makes the test's session and storage the ones that runtime sees.
const shared = testEffectShared(
  AppNodeBuilderV1.build(
    LayerNode.group([
      Session.node,
      Wakeup.node,
      Storage.node,
      InstanceStore.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

// Exec-form hooks need no shell quoting: `bun -e <code>`.
const exec = (code: string): KiloHooks.Handler => ({ type: "command", command: process.execPath, args: ["-e", code] })
// A hook that appends its stdin (one JSON line) to a marker file, then runs `extra`.
const record = (file: string, extra = "") =>
  exec(
    `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(file)}, fs.readFileSync(0, 'utf8') + '\\n'); ${extra}`,
  )
const lines = (file: string) =>
  Effect.promise(async () =>
    (await Bun.file(file).exists())
      ? (await Bun.file(file).text())
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [],
  )
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code === "EPERM"
  }
}

/**
 * Trusted hooks for the test: written to a managed config directory (project config hooks are
 * ignored), restored when the test scope closes. Set before the instance first reads its config.
 */
const managed = (hooks: KiloHooks.Hooks) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-hooks-managed-"))
      await Bun.write(path.join(dir, "kilo.json"), JSON.stringify({ hooks }))
      const prev = process.env.KILO_TEST_MANAGED_CONFIG_DIR
      process.env.KILO_TEST_MANAGED_CONFIG_DIR = dir
      return { dir, prev }
    }),
    (item) =>
      Effect.promise(async () => {
        if (item.prev === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
        else process.env.KILO_TEST_MANAGED_CONFIG_DIR = item.prev
        await fs.rm(item.dir, { recursive: true, force: true })
      }),
  )

const objective = "Improve the validation workflow"

const setup = Effect.fnUntraced(function* (hooks: KiloHooks.Hooks) {
  yield* managed(hooks)
  const llm = yield* TestLLMServer
  const instance = yield* TestInstance
  const model = {
    name: "Test Model",
    tool_call: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 100000, output: 10000 },
  }
  yield* Effect.promise(() =>
    Bun.write(
      path.join(instance.directory, "opencode.json"),
      JSON.stringify({
        model: "test/test-model",
        small_model: "test/test-model",
        enabled_providers: ["test"],
        formatter: false,
        lsp: false,
        provider: {
          test: {
            name: "Test",
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "test-key", baseURL: llm.url },
            models: { "test-model": model },
          },
        },
      }),
    ),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const session = yield* sessions.create({ title: "Unattended hooks" })
  const command = (args: string) =>
    awaitWithTimeout(
      prompt.command({
        sessionID: session.id,
        command: "goal",
        arguments: args,
        agent: "code",
        model: "test/test-model",
      }),
      "goal command waited for autonomous work",
      "10 seconds",
    )
  const metadata = sessions.get(session.id).pipe(Effect.map((value) => value.metadata))
  const paused = pollWithTimeout(
    metadata.pipe(Effect.map((value) => (GoalState.read(value)?.active === false ? true : undefined))),
    "goal did not settle",
    "20 seconds",
  )
  const report = (status: "complete" | "blocked", reason: string) => [
    reply().tool("goal_report", { status, reason }),
    reply().text("Final report").stop(),
  ]
  return { llm, instance, sessions, session, command, metadata, paused, report }
})

const wakeup = (input: { sessionID: Session.Info["id"]; directory: string; prompt?: string }): Wakeup.Info => ({
  id: Wakeup.ID.ascending(),
  sessionID: input.sessionID,
  directory: input.directory,
  prompt: input.prompt ?? "poll the deploy",
  dueAt: Date.now() - 1_000,
  created: Date.now() - 60_000,
})

describe("GoalReport verdicts", () => {
  it.effect("retries with the block reason, pauses on the third rejection or a stop, and keeps context", () =>
    Effect.sync(() => {
      const verdict = (value: Partial<KiloHooks.Verdict>) => ({ context: [], ...value })
      expect(KiloHookUnattended.report(undefined, 0)).toEqual({ context: "" })
      expect(KiloHookUnattended.report(verdict({ block: "no changelog" }), 0)).toEqual({
        retry: "GoalReport hook feedback: no changelog",
        context: "",
      })
      expect(KiloHookUnattended.report(verdict({ block: "no changelog" }), 2)).toEqual({
        pause: "GoalReport hook rejected the report 3 times: no changelog",
        context: "",
      })
      expect(KiloHookUnattended.report(verdict({ block: "x", stop: "" }), 0)).toEqual({
        pause: "GoalReport hook stopped the goal: No reason given.",
        context: "",
      })
      expect(KiloHookUnattended.report(verdict({ context: ["CI is green", "Coverage 91%"] }), 1)).toEqual({
        context: "\n\nHook: CI is green\n\nCoverage 91%",
      })
    }),
  )
})

describe("WakeupFire verdicts", () => {
  it.effect("skips on a block or a stop and wraps context", () =>
    Effect.sync(() => {
      expect(KiloHookUnattended.skipped({ context: [], block: "maintenance window" })).toEqual({
        skip: "maintenance window",
        context: "",
      })
      expect(KiloHookUnattended.skipped({ context: [], stop: "" })).toEqual({ skip: "No reason given.", context: "" })
      expect(KiloHookUnattended.skipped({ context: ["deploy is green"] }).context).toBe(
        '\n\n<hook_context event="WakeupFire">\ndeploy is green\n</hook_context>',
      )
    }),
  )
})

describe("GoalReport hooks", () => {
  it.instance(
    "a blocking hook keeps the goal running with its feedback until the report passes",
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-goal-report-")))
      const marker = path.join(dir, "marker")
      const run = yield* setup({
        GoalReport: [
          {
            matcher: "complete",
            hooks: [
              record(
                marker,
                "if (fs.readFileSync(" +
                  JSON.stringify(marker) +
                  ", 'utf8').trim().split('\\n').length === 1) { process.stderr.write('add a changelog entry'); process.exit(2) }",
              ),
            ],
          },
        ],
      })
      yield* run.llm.push(...run.report("complete", "Tests pass."), ...run.report("complete", "Changelog added."))
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "complete",
        reason: expect.stringContaining("Changelog added."),
      })
      const hits = yield* run.llm.hits
      expect(hits).toHaveLength(4)
      expect(JSON.stringify(hits.at(2)?.body.messages)).toContain("GoalReport hook feedback: add a changelog entry")
      const inputs = yield* lines(marker)
      expect(inputs).toHaveLength(2)
      expect(inputs.at(0)).toMatchObject({
        hook_event_name: "GoalReport",
        session_id: run.session.id,
        goal: objective,
        reported_status: "complete",
        reason: "Tests pass.",
        report_hook_active: false,
        attempt: 0,
      })
      expect(inputs.at(1)).toMatchObject({ reason: "Changelog added.", report_hook_active: true, attempt: 1 })
    }),
    30_000,
  )

  it.instance(
    "a hook that always blocks pauses the goal after three rejections",
    Effect.gen(function* () {
      const run = yield* setup({
        GoalReport: [{ hooks: [exec("process.stderr.write('not verified'); process.exit(2)")] }],
      })
      yield* run.llm.push(
        ...run.report("complete", "One."),
        ...run.report("complete", "Two."),
        ...run.report("blocked", "Three."),
      )
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        reason: "GoalReport hook rejected the report 3 times: not verified",
      })
      expect(yield* run.llm.hits).toHaveLength(6)
    }),
    30_000,
  )

  it.instance(
    "an allowing hook's context joins the settled reason",
    Effect.gen(function* () {
      const run = yield* setup({
        GoalReport: [
          {
            hooks: [exec("console.log(JSON.stringify({ hookSpecificOutput: { additionalContext: 'CI is green' } }))")],
          },
        ],
      })
      yield* run.llm.push(...run.report("complete", "Tests pass."))
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "complete",
        reason: "Reported by the working model, not independently verified: Tests pass.\n\nHook: CI is green",
      })
    }),
    30_000,
  )

  it.instance(
    "pausing the goal while its GoalReport hook runs settles at once and kills the hook",
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-goal-report-")))
      const marker = path.join(dir, "pid")
      const run = yield* setup({
        GoalReport: [
          {
            hooks: [
              exec(
                `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 30000)`,
              ),
            ],
          },
        ],
      })
      yield* run.llm.push(...run.report("complete", "Tests pass."))
      yield* run.command(objective)
      const pid = yield* pollWithTimeout(
        Effect.promise(async () =>
          (await Bun.file(marker).exists()) ? Number(await Bun.file(marker).text()) || undefined : undefined,
        ),
        "the GoalReport hook did not start",
        "15 seconds",
      )
      const start = Date.now()
      yield* run.command("pause")
      yield* run.paused
      expect(Date.now() - start).toBeLessThan(5_000)
      expect(GoalState.read(yield* run.metadata)?.status).toBe("paused")
      yield* pollWithTimeout(
        Effect.sync(() => (alive(pid) ? undefined : true)),
        "the GoalReport hook was not killed",
        "5 seconds",
      )
    }),
    30_000,
  )
})

describe("WakeupFire hooks", () => {
  it.instance(
    "a context hook adds its text to the wake prompt and sees the wake",
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-wakeup-fire-")))
      const marker = path.join(dir, "marker")
      const run = yield* setup({
        WakeupFire: [
          {
            matcher: "once",
            hooks: [
              record(
                marker,
                "console.log(JSON.stringify({ hookSpecificOutput: { additionalContext: 'deploy is green' } }))",
              ),
            ],
          },
        ],
      })
      yield* run.llm.push(reply().text("Checked").stop())
      const info = wakeup({ sessionID: run.session.id, directory: run.instance.directory })
      yield* deliver({ info, session: run.session })
      // The wake's turn runs forked from the delivery.
      const hits = yield* pollWithTimeout(
        run.llm.hits.pipe(Effect.map((items) => (items.length ? items : undefined))),
        "the wake did not prompt the session",
        "15 seconds",
      )
      const body = JSON.stringify(hits.at(0)?.body.messages)
      expect(body).toContain("[scheduled wakeup] poll the deploy")
      expect(body).toContain("deploy is green")
      expect(yield* lines(marker)).toEqual([
        expect.objectContaining({
          hook_event_name: "WakeupFire",
          session_id: run.session.id,
          kind: "once",
          wakeup_id: info.id,
          prompt: "poll the deploy",
          due_at: new Date(info.dueAt).toISOString(),
          goal_linked: false,
        }),
      ])
    }),
    30_000,
  )

  it.instance(
    "a blocking hook skips a cron occurrence without a prompt",
    Effect.gen(function* () {
      const run = yield* setup({
        WakeupFire: [{ matcher: "cron", hooks: [exec("process.stderr.write('quiet hours'); process.exit(2)")] }],
      })
      yield* deliver({
        info: wakeup({ sessionID: run.session.id, directory: run.instance.directory }),
        kind: "cron",
        session: run.session,
      })
      expect(yield* run.sessions.messages({ sessionID: run.session.id })).toHaveLength(0)
      expect(yield* run.llm.hits).toHaveLength(0)
    }),
    30_000,
  )

  it.instance(
    "a blocking hook pauses a goal waiting on that one-shot wakeup with the reason",
    Effect.gen(function* () {
      const run = yield* setup({
        WakeupFire: [{ hooks: [exec("process.stderr.write('deploy frozen'); process.exit(2)")] }],
      })
      const info = wakeup({ sessionID: run.session.id, directory: run.instance.directory })
      const wait: GoalLink.Wait = { kind: "wakeup", id: info.id, label: info.prompt }
      yield* run.sessions.setMetadata({
        sessionID: run.session.id,
        metadata: { "kilo.goal": { text: objective, status: "waiting", active: false, wait } },
      })
      const session = yield* run.sessions.get(run.session.id)
      GoalLink.hydrate(session.id, session.metadata)
      yield* deliver({ info, session, wait })
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        active: false,
        reason: "WakeupFire hook skipped the wake: deploy frozen",
      })
      expect(GoalState.hold(session.id)).toBe(false)
      expect(GoalLink.get(session.id)).toBeUndefined()
      expect(yield* run.llm.hits).toHaveLength(0)
    }),
    30_000,
  )

  it.instance(
    "a wake skipped while the goal turn that scheduled it still runs pauses the goal instead of waiting",
    Effect.gen(function* () {
      const run = yield* setup({
        WakeupFire: [{ hooks: [exec("process.stderr.write('deploy frozen'); process.exit(2)")] }],
      })
      const gate = Promise.withResolvers<void>()
      yield* run.llm.push(
        reply().tool("schedule_wakeup", { prompt: "check the deploy", delay: "1h" }),
        reply().wait(gate.promise).text("Waiting for the deploy").stop(),
      )
      yield* run.command(objective)
      const wake = yield* Wakeup.Service
      const info = yield* pollWithTimeout(
        wake.list({ sessionID: run.session.id }).pipe(Effect.map((items) => items.at(0))),
        "the goal turn did not schedule a wakeup",
        "15 seconds",
      )
      // The wake fires while the turn is still running, so the in-flight goal turn owns it (D3).
      const session = yield* run.sessions.get(run.session.id)
      expect(GoalState.active(session.id)).toBe(true)
      const wait = GoalLink.claim(session.id, info, "wakeup", session.metadata)
      expect(wait?.id).toBe(info.id)
      yield* deliver({ info, session, wait })
      gate.resolve()
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        reason: "WakeupFire hook skipped the wake: deploy frozen",
      })
      expect(GoalLink.get(session.id)).toBeUndefined()
      // Settling cancels the session's timers right after the status is written.
      yield* pollWithTimeout(
        wake.list({ sessionID: session.id }).pipe(Effect.map((items) => (items.length ? undefined : true))),
        "the paused goal kept its wakeup",
        "5 seconds",
      )
      expect(yield* run.llm.hits).toHaveLength(2)
    }),
    30_000,
  )

  it.instance(
    "a skipped cron occurrence keeps the goal waiting while the cron is scheduled, and pauses it once it is gone",
    Effect.gen(function* () {
      const run = yield* setup({
        WakeupFire: [{ matcher: "cron", hooks: [exec("process.stderr.write('quiet hours'); process.exit(2)")] }],
      })
      const storage = yield* Storage.Service
      const info = wakeup({ sessionID: run.session.id, directory: run.instance.directory })
      const task: Wakeup.CronInfo = {
        id: info.id,
        sessionID: info.sessionID,
        directory: info.directory,
        prompt: info.prompt,
        schedule: "0 9 * * *",
        recurring: true,
        dueAt: Date.now() + 3_600_000,
        expiresAt: Date.now() + Wakeup.CRON_TTL_MS,
        created: info.created,
      }
      const key = ["cron", String(task.sessionID), String(task.id)]
      yield* storage.write(key, task)
      const wait: GoalLink.Wait = { kind: "cron", id: task.id, label: task.prompt, recurring: true }
      yield* run.sessions.setMetadata({
        sessionID: run.session.id,
        metadata: { "kilo.goal": { text: objective, status: "waiting", active: false, wait } },
      })
      const session = yield* run.sessions.get(run.session.id)
      GoalLink.hydrate(session.id, session.metadata)
      yield* deliver({ info, kind: "cron", session, wait })
      expect(GoalState.read(yield* run.metadata)).toMatchObject({ status: "waiting", wait: { id: task.id } })
      expect(GoalLink.get(session.id)?.id).toBe(task.id)
      // The next window is past the cron's expiry: `rearm` dropped the record before this fire.
      yield* storage.remove(key)
      yield* deliver({ info, kind: "cron", session, wait })
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        reason: "WakeupFire hook skipped the wake: quiet hours",
      })
      expect(GoalLink.get(session.id)).toBeUndefined()
      expect(yield* run.llm.hits).toHaveLength(0)
    }),
    30_000,
  )

  it.instance(
    "a skipped wake leaves a goal that settled while the hook ran as it is",
    Effect.gen(function* () {
      const run = yield* setup({
        WakeupFire: [{ hooks: [exec("process.stderr.write('deploy frozen'); process.exit(2)")] }],
      })
      const info = wakeup({ sessionID: run.session.id, directory: run.instance.directory })
      const wait: GoalLink.Wait = { kind: "wakeup", id: info.id, label: info.prompt }
      yield* run.sessions.setMetadata({
        sessionID: run.session.id,
        metadata: { "kilo.goal": { text: objective, status: "complete", active: false, reason: "Done." } },
      })
      yield* deliver({ info, session: yield* run.sessions.get(run.session.id), wait })
      expect(GoalState.read(yield* run.metadata)).toMatchObject({ status: "complete", reason: "Done." })
    }),
    30_000,
  )

  shared.live(
    "a cron occurrence due while the previous occurrence's hook still runs is skipped",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const marker = path.join(dir, "marker")
        yield* managed({
          WakeupFire: [{ hooks: [{ ...record(marker, "setTimeout(() => process.exit(2), 2000)"), timeout: 8 }] }],
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => disposeAllInstances()))
        yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({ title: "Busy cron" })
          const info = wakeup({ sessionID: session.id, directory: dir })
          const fire = yield* Fire
          const count = (size: number) =>
            pollWithTimeout(
              lines(marker).pipe(Effect.map((items) => (items.length === size ? items : undefined))),
              `the WakeupFire hook did not run ${size} times`,
              "10 seconds",
            )
          yield* fire.run(info, { kind: "cron" })
          yield* count(1)
          // Due again while the first occurrence's hook still runs: skipped without a hook run.
          yield* fire.run(info, { kind: "cron" })
          yield* Effect.sleep("3 seconds")
          expect(yield* lines(marker)).toHaveLength(1)
          // Once that delivery is over, the next occurrence runs its hooks again.
          yield* fire.run(info, { kind: "cron" })
          yield* count(2)
          yield* Effect.sleep("2500 millis")
          expect(yield* sessions.messages({ sessionID: session.id })).toHaveLength(0)
        }).pipe(provideInstanceEffect(dir), Effect.provide(fireLayer))
      }),
    40_000,
  )

  shared.live(
    "an overdue wakeup whose hook is slow does not delay adopt, and a cron still gets its next run",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const marker = path.join(dir, "marker")
        yield* managed({
          WakeupFire: [{ hooks: [{ ...record(marker, "setTimeout(() => process.exit(2), 4000)"), timeout: 8 }] }],
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => disposeAllInstances()))
        yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const storage = yield* Storage.Service
          const wake = yield* Wakeup.Service
          const session = yield* sessions.create({ title: "Overdue wakeup" })
          const info = wakeup({ sessionID: session.id, directory: dir })
          const task: Wakeup.CronInfo = {
            id: Wakeup.ID.ascending(),
            sessionID: session.id,
            directory: dir,
            prompt: "nightly report",
            schedule: "*/5 * * * *",
            recurring: true,
            dueAt: Date.now() - 1_000,
            expiresAt: Date.now() + Wakeup.CRON_TTL_MS,
            created: Date.now() - 60_000,
          }
          yield* storage.write(["wakeup", String(info.sessionID), String(info.id)], info)
          yield* storage.write(["cron", String(task.sessionID), String(task.id)], task)
          const start = Date.now()
          yield* wake.adopt(dir)
          // The hooks keep running for 4 s; adopt returns long before them.
          expect(Date.now() - start).toBeLessThan(3_500)
          const inputs = yield* pollWithTimeout(
            lines(marker).pipe(Effect.map((items) => (items.length >= 2 ? items : undefined))),
            "the WakeupFire hooks did not run",
            "15 seconds",
          )
          expect(inputs.map((item) => item.kind).toSorted()).toEqual(["cron", "once"])
          expect(inputs.every((item) => item.session_id === session.id)).toBe(true)
          // The cron's next occurrence was persisted before the fire, so the schedule continues.
          const next = (yield* wake.cronList({ sessionID: session.id })).find((item) => item.id === task.id)
          expect(next?.dueAt).toBeGreaterThan(Date.now())
          expect(yield* wake.list({ sessionID: session.id })).toHaveLength(0)
          // The blocking hooks skipped both occurrences: no prompt reached the session.
          yield* Effect.sleep("4500 millis")
          expect(yield* sessions.messages({ sessionID: session.id })).toHaveLength(0)
          yield* wake.cronCancel(task.id)
        }).pipe(provideInstanceEffect(dir))
      }),
    40_000,
  )
})
