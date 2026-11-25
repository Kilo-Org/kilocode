import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Form } from "@opencode/core/form"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Tool } from "@opencode/core/tool"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { SessionEvent } from "@opencode/schema/session-event"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { eventually, waitUntil } from "../lib/eventually"
import { registerToolPlugin } from "../lib/tool"

const testModelNode = makeLocationNode({
  service: SessionRunnerModel.Service,
  layer: Layer.succeed(
    SessionRunnerModel.Service,
    SessionRunnerModel.Service.of({
      resolve: (_session, _available, request) =>
        Effect.succeed(
          SessionRunnerModel.resolved(
            LanguageModel.make({ id: request.agent, provider: "test", route: OpenAIChat.route }),
            {
              capabilities: Model.Capabilities.default(),
              cost: [],
              limit: { context: 128_000, output: 8_192 },
            },
          ),
        ),
    }),
  ),
  deps: [],
})

const testGlobalNode = makeGlobalNode({
  service: Global.Service,
  layer: tempGlobalLayer,
  deps: [],
})

const testLLMNode = makeGlobalNode({
  name: "test/question-background-llm",
  layer: TestLLM.testLayer({}),
  deps: [],
})

const testPluginSupervisor = makeLocationNode({
  name: "test/question-background-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((editor) => {
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        })
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.mode = "subagent"
          agent.description = "Background reviewer subagent"
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        })
        editor.default(Agent.ID.make("build"))
      })
      yield* registerToolPlugin(QuestionTool.Plugin)
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Form.node,
    Job.node,
    Model.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    SubagentJob.node,
    Tool.node,
  ],
})

const rootNode = LayerNode.group([
  Bus.node,
  Database.node,
  Job.node,
  LocationServiceMap.node,
  Session.node,
  SubagentJob.node,
  testLLMNode,
])

const testLayer = AppNodeBuilder.build(rootNode, [
  Global.node.replace(testGlobalNode),
  LayerNodePlatform.llmClient.replace(testLLMNode),
  offlineModels,
  PluginSupervisor.node.replace(testPluginSupervisor),
  SessionRunnerModel.node.replace(testModelNode),
])

const harness = testEffect(testLayer)

const prepareLocation = Effect.fn("question-background.prepareLocation")(function* (dir: string) {
  const locations = yield* LocationServiceMap.Service
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir) })
  const layer = locations.get(ref)
  yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(layer))
  return { ref, layer }
})

const trackCancellations = (sessionID: string) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const events: Array<{ readonly id: Form.ID; readonly sessionID: string }> = []
    yield* bus.subscribe(Form.Event.Cancelled).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event.data)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return events
  })

const trackInboxEnqueues = (sessionID: string) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const texts: string[] = []
    yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID && event.data.item.type === "synthetic"),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.data.item.type === "synthetic") texts.push(event.data.item.payload.text)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return texts
  })

const answerFirstField = (form: Form.Info, value: string): Form.Answer => {
  const field = form.fields[0]
  return { [field.key]: field.type === "multiselect" ? [value] : value }
}

const requestText = (request: Parameters<TestLLM.Responder>[0]) => JSON.stringify(request.messages)

describe("kilocode/question-background (#16019)", () => {
  harness.live(
    "keeps open question alive when background steer message arrives and delivers both on reply",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const loc = yield* prepareLocation(dir.path)
        const llm = yield* TestLLM.Test
        const step1Gate = yield* Deferred.make<void>()
        let step = 0
        yield* llm.serve(() => {
          step += 1
          if (step === 1) {
            return Stream.unwrap(
              Deferred.await(step1Gate).pipe(
                Effect.as(
                  Stream.fromIterable(
                    TestLLM.toolCall("call-q1", "question", {
                      questions: [
                        {
                          question: "Choose a deployment target",
                          header: "Target",
                          options: [
                            { label: "Staging", description: "Deploy to staging" },
                            { label: "Prod", description: "Deploy to production" },
                          ],
                        },
                      ],
                    }),
                  ),
                ),
              ),
            )
          }
          return TestLLM.text("Done after reply and background steer", "done-steer")
        })

        return yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const forms = yield* Form.Service
          const created = yield* sessions.create({ location: loc.ref, title: "question-steer" })
          const cancelled = yield* trackCancellations(created.id)
          const enqueued = yield* trackInboxEnqueues(created.id)

          const run = yield* sessions
            .prompt({
              sessionID: created.id,
              text: "Deploy the service",
            })
            .pipe(Effect.forkScoped)

          // Wait until step 1 is streaming, then admit a steer message before question opens.
          yield* llm.wait(1)
          yield* sessions.synthetic({
            sessionID: created.id,
            text: "Pre-question background notice",
            metadata: { source: "wakeup" },
          })
          yield* waitUntil(Effect.sync(() => enqueued.some((text) => text.includes("Pre-question background notice"))))
          yield* Deferred.succeed(step1Gate, undefined)

          const pending = yield* eventually(forms.list({ sessionID: created.id }), (list) => list.length === 1)
          const form = pending[0]
          expect(form.sessionID).toBe(created.id)

          // Background steer result arrives while the question form is actively waiting for input.
          yield* sessions.synthetic({
            sessionID: created.id,
            text: "Background CI job passed while question open",
            metadata: { source: "wakeup" },
          })

          yield* waitUntil(
            Effect.sync(() => enqueued.some((text) => text.includes("Background CI job passed while question open"))),
          )
          yield* Effect.yieldNow

          const current = yield* forms.get(form.id)
          expect(current.id).toBe(form.id)
          expect(yield* forms.list({ sessionID: created.id })).toHaveLength(1)
          expect(cancelled).toHaveLength(0)

          yield* forms.reply({ id: form.id, answer: answerFirstField(form, "Staging") })
          yield* Fiber.join(run)
          yield* sessions.wait(created.id)

          expect(cancelled).toHaveLength(0)
          const requests = yield* llm.requests()
          expect(requests).toHaveLength(2)
          const followup = requestText(requests[1])
          expect(followup).toContain("Staging")
          expect(followup).toContain("Pre-question background notice")
          expect(followup).toContain("Background CI job passed while question open")
        }).pipe(Effect.provide(loc.layer))
      }),
    30_000,
  )

  harness.live(
    "keeps parent question open when live SubagentTool finishes in background and delivers subagent report after reply",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const loc = yield* prepareLocation(dir.path)
        const llm = yield* TestLLM.Test
        const childGate = yield* Deferred.make<void>()
        let parentStep = 0

        yield* llm.serve((request) => {
          if (request.model.id !== "build") {
            return Stream.unwrap(
              Deferred.await(childGate).pipe(
                Effect.as(Stream.fromIterable(TestLLM.text("Subagent findings: all green", "subagent-done"))),
              ),
            )
          }
          parentStep += 1
          if (parentStep === 1) {
            return TestLLM.toolCall("call-subagent", "subagent", {
              description: "Check repo health",
              prompt: "Check repo health in the background",
              agent: "reviewer",
            })
          }
          if (parentStep === 2) {
            return TestLLM.toolCall("call-q2", "question", {
              questions: [
                {
                  question: "Approve release?",
                  header: "Release",
                  options: [
                    { label: "Approve", description: "Ship release" },
                    { label: "Hold", description: "Wait for review" },
                  ],
                },
              ],
            })
          }
          return TestLLM.text("Handled answer and subagent report", "parent-done")
        })

        return yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const forms = yield* Form.Service
          const jobs = yield* Job.Service
          const created = yield* sessions.create({ location: loc.ref, title: "question-subagent" })
          const cancelled = yield* trackCancellations(created.id)
          const enqueued = yield* trackInboxEnqueues(created.id)

          const run = yield* sessions
            .prompt({
              sessionID: created.id,
              text: "Run background check and ask me about release",
            })
            .pipe(Effect.forkScoped)

          const pending = yield* eventually(forms.list({ sessionID: created.id }), (list) => list.length === 1)
          const form = pending[0]
          expect(form.sessionID).toBe(created.id)

          // Let the background subagent finish and emit <subagent> to the parent inbox while form is pending.
          yield* Deferred.succeed(childGate, undefined)

          yield* waitUntil(
            Effect.gen(function* () {
              const pendingJobs = yield* jobs.pendingBackground
              const hasReport = enqueued.some(
                (text) => text.includes("<subagent") && text.includes("Subagent findings: all green"),
              )
              return pendingJobs.length === 0 && hasReport
            }),
          )
          yield* Effect.yieldNow

          const current = yield* forms.get(form.id)
          expect(current.id).toBe(form.id)
          expect(yield* forms.list({ sessionID: created.id })).toHaveLength(1)
          expect(cancelled).toHaveLength(0)

          yield* forms.reply({ id: form.id, answer: answerFirstField(form, "Approve") })
          yield* Fiber.join(run)
          yield* sessions.wait(created.id)

          expect(cancelled).toHaveLength(0)
          const requests = yield* llm.requests()
          const parentRequests = requests.filter((req) => req.model.id === "build")
          expect(parentRequests.length).toBeGreaterThanOrEqual(3)
          const afterReply = requestText(parentRequests[2])
          expect(afterReply).toContain("Approve")
          expect(afterReply).toContain("<subagent")
          expect(afterReply).toContain("Subagent findings: all green")
        }).pipe(Effect.provide(loc.layer))
      }),
    30_000,
  )

  harness.live(
    "keeps question open on background queue message and drains it at idle boundary after reply",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const loc = yield* prepareLocation(dir.path)
        const llm = yield* TestLLM.Test
        let step = 0

        yield* llm.serve(() => {
          step += 1
          if (step === 1) {
            return TestLLM.toolCall("call-q3", "question", {
              questions: [
                {
                  question: "Pick environment",
                  header: "Env",
                  options: [
                    { label: "Dev", description: "Development" },
                    { label: "Prod", description: "Production" },
                  ],
                },
              ],
            })
          }
          if (step === 2) {
            return TestLLM.text("Answer processed before idle drain", "step-2")
          }
          return TestLLM.text("Queued message drained at idle boundary", "step-3")
        })

        return yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const forms = yield* Form.Service
          const created = yield* sessions.create({ location: loc.ref, title: "question-queue" })
          const cancelled = yield* trackCancellations(created.id)
          const enqueued = yield* trackInboxEnqueues(created.id)

          const run = yield* sessions
            .prompt({
              sessionID: created.id,
              text: "Ask me and handle background queue",
            })
            .pipe(Effect.forkScoped)

          const pending = yield* eventually(forms.list({ sessionID: created.id }), (list) => list.length === 1)
          const form = pending[0]

          yield* sessions.synthetic({
            sessionID: created.id,
            text: "Queued background summary",
            delivery: "queue",
            metadata: { source: "background-job" },
          })

          yield* waitUntil(Effect.sync(() => enqueued.some((text) => text.includes("Queued background summary"))))
          yield* Effect.yieldNow

          const current = yield* forms.get(form.id)
          expect(current.id).toBe(form.id)
          expect(yield* forms.list({ sessionID: created.id })).toHaveLength(1)
          expect(cancelled).toHaveLength(0)

          yield* forms.reply({ id: form.id, answer: answerFirstField(form, "Dev") })
          yield* Fiber.join(run)
          yield* llm.wait(3)
          yield* sessions.wait(created.id)

          expect(cancelled).toHaveLength(0)
          const requests = yield* llm.requests()
          expect(requests).toHaveLength(3)

          const step2 = requestText(requests[1])
          expect(step2).toContain("Dev")
          expect(step2).not.toContain("Queued background summary")

          const step3 = requestText(requests[2])
          expect(step3).toContain("Queued background summary")
        }).pipe(Effect.provide(loc.layer))
      }),
    30_000,
  )

  harness.live(
    "explicit Session.interrupt still cancels an open question form",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const loc = yield* prepareLocation(dir.path)
        const llm = yield* TestLLM.Test

        yield* llm.serve(() =>
          TestLLM.toolCall("call-q4", "question", {
            questions: [
              {
                question: "Confirm cancellation guard",
                header: "Guard",
                options: [
                  { label: "Yes", description: "Continue" },
                  { label: "No", description: "Stop" },
                ],
              },
            ],
          }),
        )

        return yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const forms = yield* Form.Service
          const created = yield* sessions.create({ location: loc.ref, title: "question-interrupt" })
          const cancelled = yield* trackCancellations(created.id)

          const run = yield* sessions
            .prompt({
              sessionID: created.id,
              text: "Ask a question then interrupt",
            })
            .pipe(Effect.forkScoped)

          const pending = yield* eventually(forms.list({ sessionID: created.id }), (list) => list.length === 1)
          const form = pending[0]

          yield* sessions.interrupt(created.id)
          yield* Fiber.join(run).pipe(Effect.ignore)
          yield* sessions.wait(created.id).pipe(Effect.ignore)

          yield* waitUntil(Effect.sync(() => cancelled.some((event) => event.id === form.id)))

          expect(yield* forms.list({ sessionID: created.id })).toHaveLength(0)
          const settled = yield* forms.reply({ id: form.id, answer: answerFirstField(form, "Yes") }).pipe(Effect.flip)
          expect(settled._tag).toBe("Form.AlreadySettledError")
          expect(cancelled.some((event) => event.id === form.id)).toBe(true)

          const msgs = yield* sessions.messages({ sessionID: created.id })
          expect(JSON.stringify(msgs)).toContain("Tool execution interrupted")
          expect(msgs.some((msg) => msg.type === "idle" && msg.outcome === "interrupted")).toBe(true)
        }).pipe(Effect.provide(loc.layer))
      }),
    30_000,
  )
})
