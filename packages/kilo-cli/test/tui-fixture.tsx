import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { run } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/util/global"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const mode = process.argv[2]
assert(mode === "conversation" || mode === "discovery-control")
process.stderr.write(`TUI fixture: ${mode} imports ready\n`)
const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const defaultListenerLimit = EventEmitter.defaultMaxListeners
const initialResizeListeners = setup.renderer.listenerCount("resize")
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })
const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, { models: false, content: process.env.KILO_FIXTURE_CONFIG })
      process.stderr.write("TUI fixture: backend listening\n")
      const tui =
        mode === "conversation"
          ? runTui(input, endpoint, { terminalHandoff })
          : run({
              app: { name: "fixture", version: "test", channel: "test" },
              server: { endpoint },
              args: {},
              config: {
                get: async () => ({ animations: false, session: { terminal: false }, attention: { enabled: false } }),
                update: async () => ({}),
              },
              packages: {
                prepare: async () => {
                  throw new Error("Unexpected package resolution")
                },
              },
              terminalHandoff,
            }).pipe(Effect.provide(Global.layerWith(input.paths)))
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        process.stderr.write("TUI fixture: handoff complete\n")
        if (mode === "discovery-control") {
          await setup.waitFor(() => Bun.file(path.join(process.cwd(), "plugin-imported")).exists(), { maxPasses: 600 })
          setup.renderer.destroy()
          await closed.promise
          return
        }
        const footer = await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })
        process.stderr.write(
          `TUI fixture: footer rendered; resize listeners=${setup.renderer.listenerCount("resize")}\n`,
        )
        assert(footer.includes("isolated interactive store"))
        assert(footer.includes("Connect Kilo to sign in"))
        assert.equal(setup.renderer.getMaxListeners(), 32)
        assert.equal(EventEmitter.defaultMaxListeners, defaultListenerLimit)
        assert.equal(new EventEmitter().getMaxListeners(), defaultListenerLimit)
        const homeListeners = setup.renderer.listenerCount("resize")
        const counts: number[] = []
        for (const width of [80, 120, 80, 120, 80, 120]) {
          const frameID = setup.renderer.frameId
          setup.resize(width, width === 80 ? 24 : 40)
          // waitForFrame can return the old home frame, before the resize event reaches Solid.
          await setup.waitFor(() => setup.renderer.frameId > frameID, { maxPasses: 600 })
          await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })
          await setup.mockInput.typeText("/models")
          await setup.waitForFrame((frame) => frame.includes("/models"), { maxPasses: 600 })
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("Select model"), { maxPasses: 600 })
          counts.push(setup.renderer.listenerCount("resize"))
          assert(setup.renderer.listenerCount("resize") <= homeListeners + 3)
          await setup.mockInput.typeText("fixture-selected")
          await setup.waitForFrame((frame) => frame.includes("Select model") && frame.includes("fixture-selected"), {
            maxPasses: 600,
          })
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => !frame.includes("Select model") && frame.includes("fixture-selected"), {
            maxPasses: 600,
          })
          await setup.waitFor(() => setup.renderer.listenerCount("resize") === homeListeners, { maxPasses: 600 })
        }
        process.stderr.write(
          `TUI fixture: dialog listener counts=${JSON.stringify(counts)}; closed=${setup.renderer.listenerCount("resize")}\n`,
        )
        await setup.mockInput.typeText("Greet the isolated TUI fixture")
        setup.mockInput.pressEnter()
        const response = await setup.waitForFrame((frame) => frame.includes("Fixture native TUI response"), {
          maxPasses: 600,
        })
        process.stderr.write("TUI fixture: response rendered\n")
        assert(response.includes("Greet the isolated TUI fixture"))
        const api = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
        await setup.waitFor(async () => Object.keys(await api.session.active()).length === 0, { maxPasses: 600 })
        const session = (await api.session.list({ directory: process.cwd() })).data[0]!
        const history = await api.message.list({ sessionID: session.id })
        assert(history.data.some((message) => message.type === "assistant" && message.agent === "build"))
        await setup.waitForFrame(
          (frame) =>
            frame.split("\n").filter((line) => /Code\s+· fixture-selected/.test(line)).length >= 2 &&
            !/\bBuild\b/.test(frame),
          { maxPasses: 600 },
        )
        await api.session.switchAgent({ sessionID: session.id, agent: "ask" })
        // Native switch projections may omit `previous` when the prior agent was implicit.
        await setup.waitForFrame((frame) => /Switched agent (?:from Code )?to Ask/.test(frame), { maxPasses: 600 })
        await api.session.switchAgent({ sessionID: session.id, agent: "build" })
        const switched = await setup.waitForFrame((frame) => /Switched agent (?:from Ask )?to Code/.test(frame), {
          maxPasses: 600,
        })
        assert(!/\bBuild\b/.test(switched))
        assert.equal(setup.renderer.isDestroyed, false)
        process.stderr.write(`TUI fixture: session idle; resize listeners=${setup.renderer.listenerCount("resize")}\n`)
        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
        assert.equal(setup.renderer.isDestroyed, true)
        assert(setup.renderer.listenerCount("resize") <= initialResizeListeners)
        assert.equal(EventEmitter.defaultMaxListeners, defaultListenerLimit)
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)
try {
  await task
  assert.equal(setup.renderer.isDestroyed, true)
  console.log(`TUI_FIXTURE_OK:${mode}`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
