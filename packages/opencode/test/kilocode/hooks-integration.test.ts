// Hook events across packages, through the real session loop, tools, compaction, goal runner and
// wakeup fire. Each case needs two packages to cooperate (for example PostCompact from the loop
// marking the session for SessionStart from the prompt side), so removing the wiring between them
// fails the case. Hooks are real processes; model turns come from the real TestLLMServer.
import { describe, expect } from "bun:test"
import fs from "fs"
import path from "path"
import { Effect, Fiber, Layer } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, type HttpServer } from "effect/unstable/http"
import type { ConfigError } from "effect/Config"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { disposeInstance } from "@/effect/instance-registry"
import { EventV2Bridge } from "@/event-v2-bridge"
import { KiloHookLifecycle } from "@/kilocode/hooks/lifecycle"
import { GoalState } from "@/kilocode/session/goal/state"
import { SessionDrain } from "@/kilocode/session/drain"
import { Wakeup } from "@/kilocode/wakeup"
import { fireLayer } from "@/kilocode/wakeup/resume"
import { Fire } from "@/kilocode/wakeup/schema"
import * as MCP from "@/mcp"
import { Permission } from "@/permission"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect, testEffectShared } from "../lib/effect"
import { reply as scripted, TestLLMServer } from "../lib/llm-server"
import {
  allow,
  alive,
  errors,
  exec,
  globalDir,
  hooks,
  isolate,
  layer,
  lines,
  project,
  record,
  ref,
  reply,
  sleeper,
  temp,
  texts,
  until,
} from "./hooks-harness"

isolate()

const it = testEffect(layer)

const text = (value: string) => ({ type: "text" as const, text: value })
const model = (value: { providerID: string; modelID: string }) => ({
  providerID: ProviderV2.ID.make(value.providerID),
  modelID: ModelV2.ID.make(value.modelID),
})

const marker = () => path.join(temp(), "marker.jsonl")
const pid = (file: string) => Number(fs.readFileSync(file, "utf8"))
const overflow = { type: "error", error: { code: "context_length_exceeded" } }

const boot = Effect.fn("test.boot")(function* () {
  const env = yield* project()
  yield* hooks({})
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Integration", permission: allow })
  return { ...env, prompt, sessions, chat }
})

/** Subscribes the hook lifecycle for the current instance, as bootstrap does. */
const subscribe = Effect.fn("test.subscribe")(function* () {
  yield* KiloHookLifecycle.subscribe({
    sessions: yield* Session.Service,
    config: yield* Config.Service,
    database: yield* Database.Service,
  })
})

/** The parts of the user messages that a SessionStart hook added, with their `source`. */
const started = (sessions: Session.Interface, sessionID: Session.Info["id"]) =>
  sessions
    .messages({ sessionID })
    .pipe(
      Effect.map((msgs) =>
        msgs
          .filter((msg) => msg.info.role === "user")
          .flatMap((msg) =>
            msg.parts.flatMap((part) =>
              part.type === "text" && part.metadata?.hook?.event === "SessionStart"
                ? [{ id: msg.info.id, text: part.text, source: part.metadata.hook.source as unknown }]
                : [],
            ),
          ),
      ),
    )

/** How often the request body carries `value`. */
const count = (body: Record<string, unknown> | undefined, value: string) => JSON.stringify(body).split(value).length - 1

describe("compaction hooks", () => {
  it.instance(
    "a compaction runs PostCompact, then SessionStart with source compact, and its context reaches the next request",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, sessions, chat } = yield* boot()
        const post = marker()
        const start = marker()
        // The SessionStart hook waits for the PostCompact record, so the order can be observed.
        const wait = JSON.stringify(post)
        yield* hooks({
          PostCompact: [{ hooks: [record(post)] }],
          SessionStart: [
            {
              matcher: "compact",
              hooks: [
                exec(
                  `const fs = require('fs'); const input = JSON.parse(fs.readFileSync(0, 'utf8')); const end = Date.now() + 5000; ` +
                    `while (!(fs.existsSync(${wait}) && fs.statSync(${wait}).size > 0) && Date.now() < end) Bun.sleepSync(20); ` +
                    `fs.appendFileSync(${JSON.stringify(start)}, JSON.stringify({ ...input, post_seen: fs.existsSync(${wait}) }) + '\\n'); ` +
                    reply({
                      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "AFTER-COMPACT-77" },
                    }),
                ),
              ],
            },
          ],
        })
        // The provider rejects the first request as too large: the loop compacts and goes on.
        yield* llm.error(400, overflow)
        yield* llm.text("the summary")
        yield* llm.text("final answer")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("first")] })
        expect(yield* llm.calls).toBe(3)

        const done = lines(post)
        expect(done).toHaveLength(1)
        expect(done[0]).toMatchObject({
          hook_event_name: "PostCompact",
          session_id: chat.id,
          trigger: "auto",
          compact_summary: "the summary",
        })
        const begun = lines(start)
        expect(begun).toHaveLength(1)
        expect(begun[0]).toMatchObject({ hook_event_name: "SessionStart", session_id: chat.id, source: "compact" })
        expect(begun[0]?.post_seen).toBe(true)

        // The context is on the request after the compaction, not on the ones before it.
        const inputs = yield* llm.inputs
        expect(count(inputs[0], "AFTER-COMPACT-77")).toBe(0)
        expect(count(inputs[1], "AFTER-COMPACT-77")).toBe(0)
        expect(count(inputs[2], "AFTER-COMPACT-77")).toBe(1)
        const parts = yield* started(sessions, chat.id)
        expect(parts.map((part) => part.source)).toEqual(["compact"])
        expect(parts[0]?.text).toContain("AFTER-COMPACT-77")
      }),
    30_000,
  )

  it.instance(
    "startup context is re-injected after a real compaction when no SessionStart handler matches compact",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, sessions, chat } = yield* boot()
        const file = marker()
        yield* hooks({
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                record(
                  file,
                  reply({
                    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "STARTUP-FACTS-42" },
                  }),
                ),
              ],
            },
          ],
        })
        yield* llm.text("one")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("first")] })
        expect(lines(file).map((item) => item.source)).toEqual(["startup"])

        // What the summarize route does: queue a compaction and run the loop over it.
        const compaction = yield* SessionCompaction.Service
        yield* compaction.create({ sessionID: chat.id, agent: "build", model: model(ref), auto: false })
        yield* llm.text("the summary")
        yield* prompt.loop({ sessionID: chat.id })

        yield* llm.text("two")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("second")] })
        // The startup hook did not run again; its text came from the earlier part.
        expect(lines(file)).toHaveLength(1)
        const parts = yield* started(sessions, chat.id)
        expect(parts.map((part) => part.source)).toEqual(["startup", "compact"])
        expect(parts[1]?.text).toBe(parts[0]?.text ?? "")
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(3)
        // The summary request saw the original startup context; the request after it has the re-injected one.
        expect(count(inputs[1], "STARTUP-FACTS-42")).toBe(1)
        // The compaction hid the original message, so the one occurrence is the re-injected part.
        expect(count(inputs[2], "STARTUP-FACTS-42")).toBe(1)
        const latest = (yield* sessions.messages({ sessionID: chat.id }))
          .filter((msg) => msg.info.role === "user")
          .at(-1)
        expect(latest?.parts.some((part) => part.type === "text" && part.text.includes("STARTUP-FACTS-42"))).toBe(true)
        expect(texts([latest!]).join("\n")).toContain("second")
      }),
    30_000,
  )
})

describe("attendance after an overflow replay", () => {
  it.instance(
    "a human prompt that overflows on its first step and is replayed can still be asked by a PreToolUse hook",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, chat } = yield* boot()
        yield* hooks({
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } })),
              ],
            },
          ],
        })
        yield* llm.text("one")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("first")] })
        // The provider rejects the next request as too large: compaction replays the prompt, and the
        // replay (all synthetic text) is the user message of every later step of the turn.
        yield* llm.error(400, overflow)
        yield* llm.text("the summary")
        yield* llm.tool("bash", { command: "true", description: "noop" })
        yield* llm.text("done")
        const fiber = yield* prompt
          .prompt({ sessionID: chat.id, agent: "build", parts: [text("run it")] })
          .pipe(Effect.forkChild)
        const permission = yield* Permission.Service
        // Unattended, the ask would be refused ("nobody can answer") and no prompt would ever appear.
        const asked = yield* pollWithTimeout(
          permission.list().pipe(Effect.map((list) => list.find((item) => item.metadata?.hookAsk === true))),
          "no forced hook prompt after the replay",
          "10 seconds",
        )
        expect(asked.metadata).toMatchObject({ hookAsk: true, reason: "risky" })
        yield* permission.reply({ requestID: asked.id, reply: "reject" })
        yield* Fiber.join(fiber)
      }),
    30_000,
  )

  it.instance(
    "a human prompt too large to replay, replaced by its summary, can still be asked by a PreToolUse hook",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, sessions, chat } = yield* boot()
        yield* hooks({
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } })),
              ],
            },
          ],
        })
        yield* llm.text("one")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("first")] })
        // The prompt is far over the replay budget, so the replay is one synthetic summary part
        // instead of the prompt's own parts.
        yield* llm.error(400, overflow)
        yield* llm.text("the summary")
        yield* llm.text("the replay summary")
        yield* llm.tool("bash", { command: "true", description: "noop" })
        yield* llm.text("done")
        const fiber = yield* prompt
          .prompt({ sessionID: chat.id, agent: "build", parts: [text("run it " + "x".repeat(400_000))] })
          .pipe(Effect.forkChild)
        const permission = yield* Permission.Service
        // Unattended, the ask would be refused ("nobody can answer") and no prompt would ever appear.
        const asked = yield* pollWithTimeout(
          permission.list().pipe(Effect.map((list) => list.find((item) => item.metadata?.hookAsk === true))),
          "no forced hook prompt after the oversized replay",
          "10 seconds",
        )
        expect(asked.metadata).toMatchObject({ hookAsk: true, reason: "risky" })
        // The replayed message is the summary, not the prompt.
        const replay = (yield* sessions.messages({ sessionID: chat.id }))
          .filter((msg) => msg.info.role === "user")
          .at(-1)
        const part = replay?.parts.find((item) => item.type === "text")
        expect(part?.type === "text" ? part.text : "").toContain("the replay summary")
        yield* permission.reply({ requestID: asked.id, reply: "reject" })
        yield* Fiber.join(fiber)
      }),
    30_000,
  )

  it.instance(
    "a human turn that overflows after a tool step, with no replay, can still be asked by a PreToolUse hook",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, chat } = yield* boot()
        yield* hooks({
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  ...exec(
                    reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } }),
                  ),
                  if: "Bash(echo risky*)",
                },
              ],
            },
          ],
        })
        // The turn makes progress (a tool step), then the provider rejects the next request as too
        // large: the compaction does not replay the prompt, it writes an auto-continue message, which
        // is the user message of every later step of the turn.
        yield* llm.tool("bash", { command: "echo safe", description: "noop" })
        yield* llm.error(400, overflow)
        yield* llm.text("the summary")
        yield* llm.tool("bash", { command: "echo risky", description: "noop" })
        yield* llm.text("done")
        const fiber = yield* prompt
          .prompt({ sessionID: chat.id, agent: "build", parts: [text("run it")] })
          .pipe(Effect.forkChild)
        const permission = yield* Permission.Service
        // Unattended, the ask would be refused ("nobody can answer") and no prompt would ever appear.
        const asked = yield* pollWithTimeout(
          permission.list().pipe(Effect.map((list) => list.find((item) => item.metadata?.hookAsk === true))),
          "no forced hook prompt after the auto-continue",
          "10 seconds",
        )
        expect(asked.metadata).toMatchObject({ hookAsk: true, reason: "risky" })
        yield* permission.reply({ requestID: asked.id, reply: "reject" })
        yield* Fiber.join(fiber)
      }),
    30_000,
  )
})

describe("tool hooks", () => {
  it.instance(
    "CwdChanged watchPaths feed FileChanged: a write to the watched file runs the hook",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, chat, directory } = yield* boot()
        const moved = marker()
        const changed = marker()
        const elsewhere = temp()
        const watched = path.join(temp(), "watched.txt")
        fs.writeFileSync(watched, "one\n")
        yield* hooks({
          CwdChanged: [
            {
              hooks: [
                record(moved, reply({ hookSpecificOutput: { hookEventName: "CwdChanged", watchPaths: [watched] } })),
              ],
            },
          ],
          FileChanged: [{ hooks: [record(changed)] }],
        })
        yield* subscribe()
        // The first call runs where the session is, the second somewhere else.
        yield* llm.tool("bash", { command: "true", description: "stay" })
        yield* llm.tool("bash", { command: "true", description: "move", workdir: elsewhere })
        yield* llm.text("done")
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("go")] })
        yield* until(() => lines(moved).length === 1)
        expect(lines(moved)[0]).toMatchObject({
          hook_event_name: "CwdChanged",
          session_id: chat.id,
          old_cwd: directory,
          new_cwd: elsewhere,
        })
        // The watcher is built a moment after the hook answered: write until it notices.
        const tick = { at: 0 }
        yield* until(() => {
          if (Date.now() - tick.at > 400) {
            tick.at = Date.now()
            fs.appendFileSync(watched, "more\n")
          }
          return lines(changed).length > 0
        }, 8_000)
        expect(lines(changed)[0]).toMatchObject({ hook_event_name: "FileChanged", file_path: watched, event: "change" })
      }),
    30_000,
  )

  it.instance(
    "disposing the instance kills the detached hooks that tool calls started",
    () =>
      Effect.gen(function* () {
        const { llm, prompt, chat, directory } = yield* boot()
        const dir = temp()
        const moved = path.join(dir, "moved")
        const post = path.join(dir, "post")
        yield* hooks({
          CwdChanged: [{ hooks: [exec(sleeper(moved, 30))] }],
          PostToolUse: [{ matcher: "Bash", hooks: [{ ...exec(sleeper(post, 30)), async: true }] }],
        })
        yield* subscribe()
        yield* llm.tool("bash", { command: "true", description: "move", workdir: temp() })
        yield* llm.text("done")
        // The turn ends while both hooks are still running.
        yield* prompt.prompt({ sessionID: chat.id, agent: "build", parts: [text("go")] })
        yield* until(() => fs.existsSync(moved) && fs.existsSync(post))
        const pids = [pid(moved), pid(post)]
        expect(pids.every(alive)).toBe(true)
        yield* Effect.promise(() => disposeInstance(directory))
        yield* until(() => pids.every((value) => !alive(value)))
      }),
    30_000,
  )
})

// The goal runner's graph (as in hooks-unattended.test.ts), with the hooks from the global config.
const goal = testEffect(
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

const objective = "Improve the validation workflow"

const setup = Effect.fnUntraced(function* (value: Config.Info["hooks"]) {
  const llm = yield* TestLLMServer
  const instance = yield* TestInstance
  const spec = {
    name: "Test Model",
    tool_call: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 100000, output: 10000 },
  }
  fs.writeFileSync(
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
          models: { "test-model": spec },
        },
      },
    }),
  )
  yield* hooks(value)
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const session = yield* sessions.create({ title: "Goal integration", permission: allow })
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
  const metadata = sessions.get(session.id).pipe(Effect.map((item) => item.metadata))
  const paused = pollWithTimeout(
    metadata.pipe(Effect.map((item) => (GoalState.read(item)?.active === false ? true : undefined))),
    "goal did not settle",
    "20 seconds",
  )
  return { llm, session, command, metadata, paused }
})

describe("goal runner", () => {
  goal.instance(
    "a PostToolBatch stop pauses the goal with the reason the loop recorded",
    Effect.gen(function* () {
      const run = yield* setup({
        PostToolBatch: [{ hooks: [exec("process.stderr.write('stop now'); process.exit(2)")] }],
      })
      yield* run.llm.push(scripted().tool("glob", { pattern: "*.md" }), scripted().text("never sent").stop())
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        reason: "PostToolBatch hook stopped the turn: stop now",
      })
      expect(yield* run.llm.hits).toHaveLength(1)
    }),
    30_000,
  )

  goal.instance(
    "a PostToolUse continue false pauses the goal with the event named in the reason",
    Effect.gen(function* () {
      const run = yield* setup({
        PostToolUse: [{ matcher: "Glob", hooks: [exec(reply({ continue: false, stopReason: "enough" }))] }],
      })
      yield* run.llm.push(scripted().tool("glob", { pattern: "*.md" }), scripted().text("never sent").stop())
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)).toMatchObject({
        status: "paused",
        reason: "A PostToolUse hook stopped the turn: enough",
      })
      expect(yield* run.llm.hits).toHaveLength(1)
    }),
    30_000,
  )
})

// The wakeup fire resolves its services from the application runtime: building these through the
// shared memo map makes the test's session and storage the ones that runtime sees.
const shared = testEffectShared(
  AppNodeBuilderV1.build(
    LayerNode.group([
      Session.node,
      Wakeup.node,
      Storage.node,
      InstanceStore.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      Config.node,
      Database.node,
    ]),
  ),
)

/** Trusted hooks for the shared runtime: a managed config directory, restored when the scope closes. */
const managed = (value: Config.Info["hooks"]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const dir = temp()
      fs.writeFileSync(path.join(dir, "kilo.json"), JSON.stringify({ hooks: value }))
      const prev = process.env.KILO_TEST_MANAGED_CONFIG_DIR
      process.env.KILO_TEST_MANAGED_CONFIG_DIR = dir
      return { dir, prev }
    }),
    (item) =>
      Effect.sync(() => {
        if (item.prev === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
        if (item.prev !== undefined) process.env.KILO_TEST_MANAGED_CONFIG_DIR = item.prev
        fs.rmSync(item.dir, { recursive: true, force: true })
      }),
  )

describe("wakeup fire", () => {
  shared.live(
    "disposing the instance kills the WakeupFire hook of a due wakeup",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const file = path.join(temp(), "pid")
        // Nothing but the managed hooks may run in this test. The instance bootstrap subscribes the
        // hook lifecycle, whose scope the detached delivery runs in.
        fs.writeFileSync(path.join(globalDir(), "kilo.json"), "{}")
        yield* managed({ WakeupFire: [{ hooks: [exec(sleeper(file, 30))] }] })
        yield* Effect.addFinalizer(() => Effect.promise(() => disposeAllInstances()))
        yield* Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "Due wakeup" })
          const info: Wakeup.Info = {
            id: Wakeup.ID.ascending(),
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            dueAt: Date.now() - 1_000,
            created: Date.now() - 60_000,
          }
          yield* (yield* Fire).run(info, { kind: "wakeup" })
          yield* until(() => fs.existsSync(file))
          const value = pid(file)
          expect(alive(value)).toBe(true)
          yield* Effect.promise(() => disposeInstance(dir))
          yield* until(() => !alive(value))
        }).pipe(provideInstanceEffect(dir), Effect.provide(fireLayer))
      }),
    40_000,
  )
})

describe("summarize route", () => {
  const noop = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
  const app = AppNodeBuilder.build(LayerNode.group([InstanceStore.node, Project.node, Session.node, Database.node]), [
    [InstanceStore.bootstrapNode, noop],
  ])
  const routes: Layer.Layer<never, ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
    disableListenLog: true,
    disableLogger: true,
  })
  const served = routes.pipe(
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
  )
  const http = testEffect(Layer.mergeAll(app, served))

  const post = (url: string, directory: string, body: unknown) =>
    HttpClientRequest.fromWeb(
      new Request(new URL(url, "http://localhost"), {
        method: "POST",
        headers: { "x-kilo-directory": directory, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ).pipe(HttpClientRequest.setUrl(url), HttpClient.execute)

  http.instance(
    "a PreCompact veto answers false and creates no compaction",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        fs.writeFileSync(path.join(test.directory, "opencode.json"), JSON.stringify({ formatter: false, lsp: false }))
        const file = marker()
        // The routes build their own config service, so the hooks file is written before any request.
        fs.writeFileSync(
          path.join(globalDir(), "kilo.json"),
          JSON.stringify({
            hooks: {
              PreCompact: [
                {
                  matcher: "manual",
                  hooks: [record(file, "process.stderr.write('keep the history'); process.exit(2)")],
                },
              ],
            },
          }),
        )
        const session = yield* Session.use.create({ title: "routes" })
        const seen = errors()
        const res = yield* post(`/session/${session.id}/summarize`, test.directory, {
          providerID: "test",
          modelID: "test-model",
        })
        seen.stop()
        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(false)
        expect(lines(file)).toMatchObject([
          { hook_event_name: "PreCompact", session_id: session.id, trigger: "manual" },
        ])
        expect(
          seen.items.some(
            (item) =>
              item.sessionID === session.id && item.message === "PreCompact hook blocked compaction: keep the history",
          ),
        ).toBe(true)
        // No compaction marker was written, so no summary request would follow.
        expect(yield* Session.use.messages({ sessionID: session.id })).toHaveLength(0)
      }),
    { git: true },
  )
})
