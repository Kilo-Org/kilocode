import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { ConfigCommandPlugin } from "@opencode/core/config/plugin/command"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { KiloWorkflowDelivery } from "@opencode/core/kilocode/session/workflow-delivery"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { ShellSelect } from "@opencode/core/shell/select"
import { WellKnown } from "@opencode/core/wellknown"
import { Event } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { emptyCredentialNode, emptyWellknownNode } from "../../fixture/config-nodes"
import { tempGlobalLayer } from "../../fixture/global"
import { location } from "../../fixture/location"
import { emptyMcpLayer } from "../../fixture/mcp"
import { offlineModels } from "../../fixture/models"
import { tmpdirScoped } from "../../fixture/tmpdir"
import { it, testEffect } from "../../lib/effect"
import { host } from "../../plugin/host"

const layout = Layer.succeed(ConfigDiscovery.LayoutService, KiloConfigDiscovery.layout)

function parse(input: unknown) {
  const normalized = ConfigNormalize.normalize(KiloConfigDiscovery.layout.normalize!(input))
  if (normalized.type !== "normalized") throw new Error("expected normalized config")
  const info = KiloConfigDiscovery.layout.parse!(input, normalized.encoded)
  if (!(info instanceof KiloConfigPolicy.Info)) throw new Error("expected Kilo config")
  return { normalized, info }
}

describe("workflow model normalization", () => {
  test("extracts native and legacy model-only entries without removing complete commands", () => {
    const input = {
      command: {
        legacy: { model: "test/legacy", variant: "high" },
        shared: { model: "test/legacy" },
        complete: { template: "Legacy template", model: "test/legacy", variant: "low" },
      },
      commands: {
        native: { model: "test/native#medium" },
        nativeSplit: { model: "test/native", variant: "high" },
        structured: { model: { providerID: "test", model: "structured", variant: "low" } },
        structuredSplit: { model: { providerID: "test", model: "structured" }, variant: "high" },
        shared: { model: "test/native" },
        full: { template: "Native template", model: "test/full#high" },
      },
      shell: "sh",
    }
    const { normalized, info } = parse(input)
    expect(normalized.diagnostics).toEqual([])
    expect(info?.shell).toBe("sh")
    expect(info.workflow_models).toMatchObject({
      legacy: { providerID: "test", model: "legacy", variant: "high" },
      native: { providerID: "test", model: "native", variant: "medium" },
      nativeSplit: { providerID: "test", model: "native", variant: "high" },
      structured: { providerID: "test", model: "structured", variant: "low" },
      structuredSplit: { providerID: "test", model: "structured", variant: "high" },
      shared: { providerID: "test", model: "native" },
    })
    expect(Object.keys(info.workflow_models ?? {}).toSorted()).toEqual([
      "legacy",
      "native",
      "nativeSplit",
      "shared",
      "structured",
      "structuredSplit",
    ])
    expect(info.workflow_models?.shared?.variant).toBeUndefined()
    expect(info?.commands).toMatchObject({
      complete: { template: "Legacy template", model: { providerID: "test", model: "legacy", variant: "low" } },
      full: { template: "Native template", model: { providerID: "test", model: "full", variant: "high" } },
    })
    expect(Object.keys(info?.commands ?? {}).toSorted()).toEqual(["complete", "full"])
    expect(input.command.legacy).toEqual({ model: "test/legacy", variant: "high" })
  })

  test("a native model-only entry can override a complete legacy command in the same document", () => {
    const { normalized, info } = parse({
      command: { review: { template: "Legacy template", model: "test/legacy" } },
      commands: { review: { model: "test/native#high" } },
    })
    expect(normalized.diagnostics).toEqual([])
    expect(info.commands?.review).toMatchObject({ template: "Legacy template" })
    expect(info.workflow_models?.review).toMatchObject({ providerID: "test", model: "native", variant: "high" })
  })

  test("an invalid native entry does not suppress a valid legacy selection of the same command", () => {
    const { normalized, info } = parse({
      command: { review: { model: "test/legacy", variant: "high" } },
      commands: { review: { model: "missing-provider" } },
    })
    expect(normalized.diagnostics.some((item) => item.path[0] === "commands" && item.path[1] === "review")).toBe(true)
    expect(info.workflow_models?.review).toMatchObject({ providerID: "test", model: "legacy", variant: "high" })
  })

  for (const key of ["command", "commands"] as const) {
    for (const invalid of [
      { model: "missing-provider" },
      { model: "test/model#" },
      { model: 42 },
      { model: "test/model", variant: 42 },
      { model: "test/model", variant: "bad#variant" },
      { model: "test/model", variant: "" },
      { model: "test/model#high", variant: "bad#variant" },
      { model: { providerID: "test", model: "model", variant: "high" }, variant: "bad#variant" },
      { model: "test/model", description: "not model-only" },
    ]) {
      test(`keeps invalid ${key} entry ${JSON.stringify(invalid)} in native validation`, () => {
        const { normalized, info } = parse({
          [key]: { bad: invalid, good: { model: "test/good#high" }, complete: { template: "Keep me" } },
          shell: "sh",
        })
        expect(normalized.diagnostics.some((item) => item.path[0] === key && item.path[1] === "bad")).toBe(true)
        expect(normalized.diagnostics.some((item) => item.path[1] === "good")).toBe(false)
        expect(info.workflow_models).toMatchObject({ good: { providerID: "test", model: "good", variant: "high" } })
        expect(Object.keys(info.workflow_models ?? {})).toEqual(["good"])
        expect(info?.commands).toMatchObject({ complete: { template: "Keep me" } })
        expect(info?.commands?.bad).toBeUndefined()
        expect(info?.shell).toBe("sh")
      })
    }
  }
})

function commandLayer(project: string, global: string) {
  const built = AppNodeBuilder.build(
    LayerNode.group([
      Command.node,
      Config.node,
      Bus.node,
      FSUtil.node,
      AppProcess.node,
      Location.node,
      Model.node,
      ShellSelect.node,
      Session.node,
      Job.node,
      SubagentJob.node,
      Agent.node,
    ]),
    [
      KiloWorkflowDelivery.override,
      Config.node.replace(Config.configured({ system: false })),
      ConfigDiscovery.node.replace(layout),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(project) },
              {
                projectDirectory: AbsolutePath.make(project),
                vcs: { type: "git", store: AbsolutePath.make(path.join(project, ".git")) },
              },
            ),
          ),
        ),
      ),
      Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
      Credential.node.replace(emptyCredentialNode),
      WellKnown.node.replace(emptyWellknownNode),
      Watcher.node.replace(Watcher.testLayer),
      Mcp.node.replace(emptyMcpLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  )
  return Layer.merge(built, Watcher.testLayer)
}

function changed(update: Watcher.Update, matches: (info: Command.Info | undefined) => boolean) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const bus = yield* Bus.Service
    const command = yield* Command.Service
    const pending = yield* bus.subscribe(Command.Event.Updated).pipe(
      Stream.filterEffect(() => Effect.map(command.get("review"), matches)),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* watcher.emit(update)
    yield* Fiber.join(pending).pipe(Effect.timeout("5 seconds"))
  })
}

describe("workflow model discovery", () => {
  it.live("overrides the winning file, follows edits and removal, and never creates orphan commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "project")
      const global = path.join(tmp.path, "global")
      const configFile = path.join(global, "kilo2.json")
      const projectConfigFile = path.join(project, "kilo2.json")
      const globalFile = path.join(global, "commands", "review.md")
      const projectFile = path.join(project, ".kilo2", "commands", "review.md")
      const config = { commands: { review: { model: "test/global#high" }, orphan: { model: "test/orphan" } } }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(globalFile), { recursive: true })
        await fs.mkdir(path.dirname(projectFile), { recursive: true })
        await fs.writeFile(configFile, JSON.stringify(config))
        await fs.writeFile(globalFile, "Global $ARGUMENTS")
        await fs.writeFile(
          projectFile,
          "---\ndescription: Project review\nmodel: test/file#low\n---\nProject $ARGUMENTS",
        )
      })

      yield* Effect.gen(function* () {
        const command = yield* Command.Service
        const bus = yield* Bus.Service
        yield* ConfigCommandPlugin.Plugin.effect(
          host({
            command: {
              list: () => Effect.die("unused command.list"),
              transform: command.transform,
              reload: command.reload,
            },
            event: { subscribe: () => bus.subscribe(Event.Updated) },
            session: {
              switchModel: () => Effect.die("A pending workflow must not switch the model"),
            },
          }),
        ).pipe(
          // A command defers its selection when the host installed a delivery policy.
          Effect.provideService(SessionInbox.Policy, {
            policy: { batchSize: () => 1, prepare: () => Effect.undefined },
          }),
        )
        yield* Effect.sleep("10 millis")
        expect(yield* command.get("review")).toMatchObject({
          description: "Project review",
          template: "Project $ARGUMENTS",
          model: { providerID: "test", model: "global", variant: "high" },
        })
        expect(yield* command.get("orphan")).toBeUndefined()
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(project) } })
        const execute = Effect.gen(function* () {
          yield* command.execute({
            name: "review",
            invocation: { sessionID: session.id, prompt: { text: "changes" }, delivery: "queue" },
          })
          const item = (yield* sessions.inbox(session.id)).at(-1)
          if (item?.type !== "user") return yield* Effect.die("Expected a pending workflow prompt")
          return item.payload
        })
        expect(yield* execute).toMatchObject({
          selection: { model: { providerID: "test", id: "global", variant: "high" } },
          text: "Project changes",
          metadata: { kilo: { injected: { title: "/review changes" } } },
        })

        yield* Effect.promise(() =>
          fs.writeFile(projectConfigFile, JSON.stringify({ commands: { review: { model: "test/project#medium" } } })),
        )
        yield* changed({ type: "create", path: projectConfigFile }, (info) => info?.model?.model === "project")
        expect(yield* execute).toMatchObject({
          selection: { model: { providerID: "test", id: "project", variant: "medium" } },
          text: "Project changes",
        })
        yield* Effect.promise(() => fs.unlink(projectConfigFile))
        yield* changed({ type: "delete", path: projectConfigFile }, (info) => info?.model?.model === "global")

        yield* Effect.promise(() =>
          fs.writeFile(projectFile, "---\ndescription: Edited review\nmodel: test/file#low\n---\nEdited $ARGUMENTS"),
        )
        yield* changed({ type: "update", path: projectFile }, (info) => info?.template === "Edited $ARGUMENTS")
        expect(yield* execute).toMatchObject({
          selection: { model: { providerID: "test", id: "global", variant: "high" } },
          text: "Edited changes",
        })

        yield* Effect.promise(() =>
          fs.writeFile(configFile, JSON.stringify({ commands: { orphan: config.commands.orphan } })),
        )
        yield* changed({ type: "update", path: configFile }, (info) => info?.model?.model === "file")
        expect(yield* execute).toMatchObject({
          selection: { model: { providerID: "test", id: "file", variant: "low" } },
        })

        yield* Effect.promise(() => fs.writeFile(configFile, JSON.stringify(config)))
        yield* changed({ type: "update", path: configFile }, (info) => info?.model?.model === "global")
        yield* Effect.promise(() => fs.unlink(projectFile))
        yield* changed({ type: "delete", path: projectFile }, (info) => info?.template === "Global $ARGUMENTS")
        expect((yield* command.get("review"))?.model).toMatchObject({
          providerID: "test",
          model: "global",
          variant: "high",
        })
        yield* Effect.promise(() => fs.unlink(globalFile))
        yield* changed({ type: "delete", path: globalFile }, (info) => info === undefined)
        expect(yield* command.get("review")).toBeUndefined()
        expect(yield* command.get("orphan")).toBeUndefined()
        // Command updates publish only when the command list changes, so a complete command marks the reload.
        yield* Effect.promise(() =>
          fs.writeFile(
            configFile,
            JSON.stringify({ commands: { review: { model: "test/other#low" }, marker: { template: "Marker" } } }),
          ),
        )
        yield* changed({ type: "update", path: configFile }, (info) => info === undefined)
        expect(yield* command.get("marker")).toMatchObject({ template: "Marker" })
        expect(yield* command.get("review")).toBeUndefined()
      }).pipe(Effect.provide(commandLayer(project, global)))
    }),
  )
})

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const workflows = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
      KiloWorkflowDelivery.override,
      Global.node.replace(tempGlobalLayer),
      Config.node.replace(Config.configured({ system: false })),
      ConfigDiscovery.node.replace(layout),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: (session) =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: session.model?.id ?? "parent", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const model = (id: string) => Model.Ref.make({ id: Model.ID.make(id), providerID: Provider.ID.make("test") })

const startWorkflowSession = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    fs.writeFile(
      path.join(tmp.path, "kilo2.json"),
      JSON.stringify({
        providers: {
          test: {
            package: "@opencode/ai/providers/openai-compatible",
            settings: { apiKey: "test-key", baseURL: "http://localhost:9/v1" },
            models: { original: {}, first: {}, second: {} },
          },
        },
        agents: { reviewer: { mode: "all" } },
        commands: {
          first: { template: "First $ARGUMENTS", model: "test/first#high" },
          second: { template: "Second $ARGUMENTS", model: "test/second" },
          missing: { template: "Missing", model: "test/does-not-exist" },
          review: { template: "Review $ARGUMENTS", agent: "reviewer" },
        },
      }),
    ),
  )
  const sessions = yield* Session.Service
  const session = yield* sessions.create({
    location: { directory: AbsolutePath.make(tmp.path) },
    agent: Agent.ID.make("build"),
    model: model("original"),
    title: "Workflow test",
  })
  return { sessions, id: session.id }
})

for (const delivery of ["queue", "steer", "queue then steer", "steer then queue"] as const) {
  workflows.live(`keeps the running model and delivers workflows in order (${delivery})`, () =>
    Effect.gen(function* () {
      const { sessions, id } = yield* startWorkflowSession()
      const llm = yield* TestLLM.Test
      // The first step uses a tool: a queued command must not change the continuation's model either.
      yield* llm.push(TestLLM.toolCall("workflow_test", "not_a_registered_tool", {}))
      const gate = yield* llm.gate()
      yield* sessions.prompt({ sessionID: id, text: "Finish the current task" })
      yield* gate.started
      const firstDelivery = delivery.startsWith("queue") ? "queue" : "steer"
      for (const command of ["first", "second"])
        yield* sessions.command({ sessionID: id, command, text: "changes", delivery: firstDelivery })
      const pending = yield* sessions.inbox(id)
      expect(pending).toHaveLength(2)
      if (delivery === "queue then steer") {
        for (const item of pending) yield* sessions.steerInbox({ sessionID: id, inboxID: item.id })
      }
      if (delivery === "steer then queue") {
        for (const item of pending) yield* sessions.queueInbox({ sessionID: id, inboxID: item.id })
      }
      expect((yield* sessions.get(id)).model).toMatchObject(model("original"))
      yield* gate.release
      yield* sessions.wait(id)
      const steered = delivery === "steer" || delivery === "queue then steer"
      expect((yield* llm.requests()).map((request) => String(request.model.id))).toEqual(
        steered ? ["original", "first", "second"] : ["original", "original", "first", "second"],
      )
      const messages = yield* sessions.context(id)
      expect(messages.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
        "Finish the current task",
        "First changes",
        "Second changes",
      ])
      expect(messages.filter((message) => message.type === "model-switched").map((message) => message.model)).toEqual([
        { ...model("first"), variant: Model.VariantID.make("high") },
        model("second"),
      ])
      // Each selection commits with the input it runs, and the transcript shows the switch before that input.
      expect(
        messages.flatMap((message) => {
          if (message.type === "model-switched") return ["switch"]
          if (message.type === "user") return [`user:${message.text}`]
          return []
        }),
      ).toEqual(["user:Finish the current task", "switch", "user:First changes", "switch", "user:Second changes"])
      expect((yield* sessions.get(id)).model).toMatchObject(model("second"))
      expect(yield* sessions.inbox(id)).toEqual([])
    }),
  )
}

workflows.live("cancels a queued workflow and leaves the model alone when command admission fails", () =>
  Effect.gen(function* () {
    const { sessions, id } = yield* startWorkflowSession()
    const llm = yield* TestLLM.Test
    const gate = yield* llm.gate()
    yield* sessions.prompt({ sessionID: id, text: "Current task" })
    yield* gate.started
    yield* sessions.command({ sessionID: id, command: "first", text: "cancel this", delivery: "queue" })
    const [item] = yield* sessions.inbox(id)
    if (!item) return yield* Effect.die("Expected the workflow in the inbox")
    yield* sessions.cancelInbox({ sessionID: id, inboxID: item.id })
    const failed = yield* sessions
      .command({
        sessionID: id,
        command: "second",
        text: "bad attachment",
        files: [{ uri: "not-a-file-uri" }],
        delivery: "queue",
      })
      .pipe(Effect.result)
    expect(failed._tag).toBe("Failure")
    expect(yield* sessions.inbox(id)).toEqual([])
    expect((yield* sessions.get(id)).model).toMatchObject(model("original"))
    yield* gate.release
    yield* sessions.wait(id)
    expect((yield* llm.requests()).map((request) => String(request.model.id))).toEqual(["original"])
  }),
)

workflows.live(
  "leaves an unavailable workflow pending without changing the model, and can recover after cancellation",
  () =>
    Effect.gen(function* () {
      const { sessions, id } = yield* startWorkflowSession()
      const llm = yield* TestLLM.Test
      yield* sessions.command({ sessionID: id, command: "missing", text: "", delivery: "queue" })
      yield* sessions.wait(id)
      const session = yield* sessions.get(id)
      expect(session.outcome).toBe("failed")
      expect(session.model).toMatchObject(model("original"))
      const [item] = yield* sessions.inbox(id)
      if (!item) return yield* Effect.die("Expected the failed workflow to remain cancellable")
      expect(yield* llm.requests()).toEqual([])
      yield* sessions.cancelInbox({ sessionID: id, inboxID: item.id })
      yield* sessions.command({ sessionID: id, command: "second", text: "retry", delivery: "queue" })
      yield* sessions.wait(id)
      expect((yield* llm.requests()).map((request) => String(request.model.id))).toEqual(["second"])
      expect((yield* sessions.get(id)).model).toMatchObject(model("second"))
    }),
)

workflows.live("applies a command's agent when the command is delivered", () =>
  Effect.gen(function* () {
    const { sessions, id } = yield* startWorkflowSession()
    const llm = yield* TestLLM.Test
    const gate = yield* llm.gate()
    yield* sessions.prompt({ sessionID: id, text: "Current task" })
    yield* gate.started
    yield* sessions.command({ sessionID: id, command: "review", text: "changes", delivery: "queue" })
    expect((yield* sessions.get(id)).agent).toBe(Agent.ID.make("build"))
    yield* gate.release
    yield* sessions.wait(id)
    expect((yield* sessions.get(id)).agent).toBe(Agent.ID.make("reviewer"))
    const messages = yield* sessions.context(id)
    // One switch, committed with the input it runs, and the first step under the new agent.
    expect(messages.filter((message) => message.type === "agent-switched").map((message) => message.agent)).toEqual([
      Agent.ID.make("reviewer"),
    ])
    expect(
      messages.flatMap((message) => {
        if (message.type === "agent-switched") return ["switch"]
        if (message.type === "user") return [`user:${message.text}`]
        return []
      }),
    ).toEqual(["user:Current task", "switch", "user:Review changes"])
    expect(messages.filter((message) => message.type === "assistant").map((message) => message.agent)).toEqual([
      Agent.ID.make("build"),
      Agent.ID.make("reviewer"),
    ])
  }),
)

workflows.live("leaves an unavailable command agent pending without changing the session", () =>
  Effect.gen(function* () {
    const { sessions, id } = yield* startWorkflowSession()
    const llm = yield* TestLLM.Test
    yield* sessions.prompt({
      sessionID: id,
      text: "Needs a missing agent",
      selection: { agent: Agent.ID.make("ghost") },
      delivery: "queue",
    })
    yield* sessions.wait(id)
    const session = yield* sessions.get(id)
    expect(session.outcome).toBe("failed")
    expect(session.agent).toBe(Agent.ID.make("build"))
    expect(yield* sessions.inbox(id)).toHaveLength(1)
    expect(yield* llm.requests()).toEqual([])
  }),
)

workflows.live("passes the workflow model and variant to a subagent without changing its parent", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, ".kilo2", "commands")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(
        path.join(tmp.path, "kilo2.json"),
        JSON.stringify({ command: { review: { model: "test/child", variant: "high" } } }),
      )
      await fs.writeFile(
        path.join(directory, "review.md"),
        "---\ndescription: Review code\nsubtask: true\n---\nReview $ARGUMENTS",
      )
    })
    const sessions = yield* Session.Service
    const llm = yield* TestLLM.Test
    const gate = yield* llm.gate()
    const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })
    const parent = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      title: "Parent session",
      agent: Agent.ID.make("build"),
      model: parentModel,
    })
    yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
    yield* gate.started
    const children = (yield* sessions.list({ parentID: parent.id })).data
    expect(children).toHaveLength(1)
    const child = children[0]
    if (!child) return yield* Effect.die("Expected a child session")
    expect(child).toMatchObject({ title: "Review code", model: { providerID: "test", id: "child", variant: "high" } })
    expect(yield* sessions.get(parent.id)).toMatchObject({ model: parentModel, agent: "build" })
    expect((yield* sessions.context(child.id)).filter((message) => message.type === "user")).toMatchObject([
      { text: "You are a subagent spawned by another session.\nReview changes" },
    ])
    yield* gate.release
    yield* llm.wait(2)
    yield* sessions.wait(parent.id)
  }),
)
