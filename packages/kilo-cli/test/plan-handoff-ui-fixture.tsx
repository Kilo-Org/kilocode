import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { runTui } from "../src/tui"
import { guardedFixtureLayout } from "./fixture"

const input = guardedFixtureLayout()
const plan = `.kilo/plans/${Date.now()}-handoff.md`
await mkdir(path.dirname(plan), { recursive: true })
await writeFile(plan, "# Handoff\n\nImplement the requested change.\n")
const setup = await createTestRenderer({ width: 160, height: 40, useThread: false })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
let called = false
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { stream?: boolean; messages?: unknown }
    if (!body.stream)
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify(body.messages).includes("Prepare a plan") ? "Original Plan" : "Implementation",
            },
          },
        ],
      })
    const tool = !called
    called = true
    const delta = tool
      ? {
          tool_calls: [
            {
              index: 0,
              id: "plan-exit",
              type: "function",
              function: { name: "plan_exit", arguments: JSON.stringify({ path: plan }) },
            },
          ],
        }
      : { role: "assistant", content: "Handoff response complete" }
    return new Response(
      [
        { choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
      ]
        .map(
          (frame) =>
            `data: ${JSON.stringify({ id: "handoff", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          content: JSON.stringify({
            model: "fixture/chat",
            providers: {
              fixture: {
                package: "aisdk:@ai-sdk/openai-compatible",
                settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
                models: { chat: {} },
              },
            },
          }),
        })
        const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        const source = yield* Effect.promise(() =>
          client.session.create({
            location,
            agent: "plan",
            title: "Original Plan",
            model: { providerID: "fixture", id: "chat" },
          }),
        )
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, {
            args: { sessionID: source.id },
            terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve }),
          }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.promise(async () => {
          await ready.promise
          await until(() => setup.captureCharFrame().includes("Original Plan"))
          await client.session.prompt({ sessionID: source.id, text: "Prepare a plan" })
          await until(() => setup.captureCharFrame().includes("Start new session"))
          // Choose the first option through the real question UI.
          setup.mockInput.pressEnter()
          await until(() => setup.captureCharFrame().includes("Implement the approved plan at"))
          const sessions = (await client.session.list({ directory: process.cwd() })).data
          assert.equal(sessions.length, 2)
          const next = sessions.find((session) => session.id !== source.id)
          assert(next)
          assert.equal(next.agent, "build")
          assert.equal((await client.session.get({ sessionID: source.id })).agent, "plan")
          await client.session.rename({ sessionID: source.id, title: "Original Plan" })
          await until(() => setup.captureCharFrame().includes("Original Plan"))
          const frame = setup.captureCharFrame()
          assert(frame.includes("Original Plan"), `original Plan tab remains open\n${frame}`)
          assert(frame.includes("handoff.md"), "new session shows its implementation prompt")
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("PLAN_HANDOFF_UI_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  await model.stop(true)
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000
  while (!check()) {
    assert(Date.now() < deadline, "Timed out waiting for TUI state")
    await Bun.sleep(50)
  }
}
