import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { run } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/util/global"
import { MouseButton, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import path from "node:path"
import manifest from "../package.json"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const mode = process.argv[2]
assert(mode === "conversation" || mode === "discovery-control")
process.stderr.write(`TUI fixture: ${mode} imports ready\n`)
const setup = await createTestRenderer({
  width: 120,
  height: 40,
  useThread: false,
  kittyKeyboard: process.env.KILO_FIXTURE_KITTY !== "false",
})
setup.renderer.start()
const defaultListenerLimit = EventEmitter.defaultMaxListeners
const initialResizeListeners = setup.renderer.listenerCount("resize")
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })
const catalog = Promise.withResolvers<void>()
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch() {
    await catalog.promise
    return Response.json({ data: [] })
  },
})
const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, {
        models: false,
        content: process.env.KILO_FIXTURE_CONFIG,
        gateway: mode === "conversation" ? { server: gateway.url.origin, backgroundRefresh: true } : undefined,
      })
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
        assert(!footer.includes("Starting Kilo"))
        // The full home screen must render before the catalog response is released.
        catalog.resolve()
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
        await setup.mockInput.typeText("Hold this reply while I queue another prompt")
        setup.mockInput.pressEnter()
        await setup.waitFor(async () => Object.keys(await api.session.active()).length > 0, { maxPasses: 600 })
        await fetch(`${process.env.KILO_FIXTURE_MODEL_URL}/fixture/started`)
        process.stderr.write("TUI fixture: held model request started\n")
        await setup.waitFor(
          () => {
            const editor = setup.renderer.currentFocusedEditor
            return editor instanceof TextareaRenderable && editor.plainText === ""
          },
          { maxPasses: 600 },
        )
        await setup.mockInput.typeText("Run this queued prompt after the current reply")
        await setup.waitForFrame((frame) => frame.includes("Run this queued prompt after the current reply"), {
          maxPasses: 600,
        })
        setup.mockInput.pressKey("x", { ctrl: true })
        setup.mockInput.pressEnter()
        await setup.waitFor(async () => (await api.session.inbox.list({ sessionID: session.id })).length === 1, {
          maxPasses: 600,
        })
        const queued = await api.session.inbox.list({ sessionID: session.id })
        assert.equal(queued[0]?.delivery, "queue")
        await setup.waitForFrame((frame) => frame.includes("1 queued"), { maxPasses: 600 })
        process.stderr.write("TUI fixture: queued dock visible\n")
        setup.mockInput.pressKey("x", { ctrl: true })
        setup.mockInput.pressKey("q")
        await setup.waitForFrame((frame) => frame.includes("Queued prompts"), { maxPasses: 600 })
        process.stderr.write("TUI fixture: queue manager open\n")
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Queued prompts"), { maxPasses: 600 })
        await fetch(`${process.env.KILO_FIXTURE_MODEL_URL}/fixture/release`)
        await setup.waitFor(async () => Object.keys(await api.session.active()).length === 0, { maxPasses: 600 })
        assert.equal((await api.session.inbox.list({ sessionID: session.id })).length, 0)
        const delivered = await api.message.list({ sessionID: session.id })
        assert.equal(delivered.data.filter((message) => message.type === "user").length, 3)
        assert.equal(delivered.data.filter((message) => message.type === "assistant").length, 3)
        process.stderr.write("TUI fixture: queued shortcut persisted and drained after the active reply\n")
        await setup.mockInput.typeText("Queue on idle starts immediately")
        setup.mockInput.pressKey("x", { ctrl: true })
        setup.mockInput.pressEnter()
        await setup.waitFor(
          async () => {
            const messages = await api.message.list({ sessionID: session.id })
            return (
              messages.data.filter((message) => message.type === "assistant").length === 4 &&
              Object.keys(await api.session.active()).length === 0
            )
          },
          { maxPasses: 600 },
        )
        assert.equal((await api.session.inbox.list({ sessionID: session.id })).length, 0)
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
        setup.resize(160, 48)
        const sidebar = await setup.waitForFrame(
          (frame) => frame.includes("Session family usage") && frame.includes(`Kilo ${manifest.version}`),
          { maxPasses: 600 },
        )
        const sidebarText = sidebar
          .split("\n")
          .map((line) => line.slice(120))
          .join("\n")
        assert(sidebarText.indexOf("Context") < sidebarText.indexOf("Session family usage"))
        assert(sidebarText.indexOf("Session family usage") < sidebarText.indexOf("Memory"))
        assert(sidebarText.indexOf("Memory") < sidebarText.indexOf("Code Indexing"))
        assert(sidebarText.indexOf("Credits") < sidebarText.indexOf(`Kilo ${manifest.version}`))
        for (const title of ["Context", "Session family usage", "Memory", "Code Indexing"]) {
          for (const [before, after] of [
            ["▼", "▶"],
            ["▶", "▼"],
          ]) {
            const frame = await setup.waitForFrame((frame) => frame.includes(`${before} ${title}`), { maxPasses: 600 })
            const lines = frame.split("\n")
            const row = lines.findIndex((line) => line.slice(120).includes(`${before} ${title}`))
            assert(row >= 0)
            await setup.mockMouse.click(lines[row]!.indexOf(`${before} ${title}`, 120), row)
            await setup.waitForFrame((frame) => frame.includes(`${after} ${title}`), { maxPasses: 600 })
          }
        }
        assert.equal(setup.renderer.isDestroyed, false)
        process.stderr.write(`TUI fixture: session idle; resize listeners=${setup.renderer.listenerCount("resize")}\n`)
        const composerRow = setup
          .captureCharFrame()
          .split("\n")
          .findLastIndex((line) => /Code\s+· fixture-selected/.test(line.slice(0, 120)))
        await setup.mockMouse.click(8, composerRow - 2)
        await api.session.rename({ sessionID: session.id, title: "First tab fixture" })
        await api.session.create({ location: { directory: process.cwd() }, title: "Second tab fixture" })
        await setup.mockInput.typeText("/sessions")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Second tab fixture"), { maxPasses: 600 })
        await setup.mockInput.typeText("Second tab fixture")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.split("\n")[0]?.includes("Second tab fixture"), { maxPasses: 600 })
        const firstTab = setup.captureCharFrame().split("\n")[0]!.indexOf("First tab fixture")
        const secondTab = setup.captureCharFrame().split("\n")[0]!.indexOf("Second tab fixture")
        assert(firstTab >= 0 && secondTab >= 0)
        await setup.mockMouse.click(firstTab, 0, MouseButton.RIGHT)
        const menu = await setup.waitForFrame((frame) => frame.includes("Rename"), { maxPasses: 600 })
        const menuRows = menu.split("\n")
        const renameRow = menuRows.findIndex((line) => line.includes("Rename"))
        await setup.mockMouse.click(menuRows[renameRow]!.indexOf("Rename"), renameRow)
        await setup.waitForFrame((frame) => frame.includes("Rename session"), { maxPasses: 600 })
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Rename session"), { maxPasses: 600 })
        await setup.mockMouse.click(firstTab, 0)
        await setup.waitForFrame((frame) => frame.includes("Greet the isolated TUI fixture"), { maxPasses: 600 })
        await setup.mockMouse.click(secondTab, 0)
        await setup.waitForFrame((frame) => !frame.includes("Greet the isolated TUI fixture"), { maxPasses: 600 })
        await setup.mockMouse.click(firstTab, 0)
        await setup.waitForFrame((frame) => frame.includes("Greet the isolated TUI fixture"), { maxPasses: 600 })
        await setup.mockMouse.click(8, composerRow - 2)
        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
        assert.equal(setup.renderer.isDestroyed, true)
        assert(setup.renderer.listenerCount("resize") <= initialResizeListeners)
        assert.equal(EventEmitter.defaultMaxListeners, defaultListenerLimit)
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            if (!setup.renderer.isDestroyed) console.error("TUI failure frame:", setup.captureCharFrame())
          }),
        ),
      )
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
  catalog.resolve()
  gateway.stop(true)
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
