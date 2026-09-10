import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { InputRenderable, TextareaRenderable, TextAttributes } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"
import { createSettingsStore, SettingsRpc, type SettingsFieldKey, type SettingsSnapshot } from "../src/settings"
import { runTui } from "../src/tui"

const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
const input = guardedFixtureLayout()
const project = process.env.TUI_SETTINGS_SCOPE === "project"
setup.renderer.start()

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const directory = process.cwd()

      // Written before the host starts, so the host's own config load is what
      // proves these values reach a real consumer.
      const store = createSettingsStore({
        layout: input,
        project: { enabled: project, directory, boundary: directory },
      })
      yield* Effect.promise(() => store.set({ scope: "profile", key: "default_agent", value: "build" }))
      yield* Effect.promise(() => store.set({ scope: "profile", key: "tool_output.max_lines", value: 123 }))
      yield* Effect.promise(() => store.set({ scope: "profile", key: "compaction.auto", value: false }))
      yield* Effect.promise(() => store.set({ scope: "profile", key: "compaction.keep.tokens", value: 512 }))
      yield* Effect.promise(() => store.set({ scope: "profile", key: "media.image.max_width", value: 1024 }))

      const endpoint = yield* launch(input, { models: false, recover: false, projectConfig: project })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))

      const entries = yield* Effect.promise(() => client.config.get({ location }))
      const document = entries.find((entry) => entry.type === "document" && entry.path === input.config)
      assert(document?.type === "document", `host did not load ${input.config}`)
      assert.equal(document.info.default_agent, "build")
      assert.equal(document.info.tool_output?.max_lines, 123)
      assert.equal(document.info.compaction?.auto, false)
      assert.equal(document.info.compaction?.keep?.tokens, 512)

      const rpc = client.rpc(SettingsRpc.Definition)
      const initial = yield* Effect.promise(() => rpc.read({}, { location }))
      assert.deepEqual(field(initial, "tool_output.max_lines").values, { profile: 123 })
      assert.equal(field(initial, "tool_output.max_lines").source, "profile")
      assert.equal(initial.scopes[0].path, input.config)
      assert.equal(initial.scopes[0].writable, true)
      assert.equal(initial.scopes[1].writable, project)
      if (!project) assert(initial.scopes[1].reason?.includes("--project-config"))
      assert.equal(initial.restartRequired, true)

      const before = yield* Effect.promise(() => client.session.list({ directory }))
      assert.equal(before.data.length, 0)

      const tui = runTui(input, endpoint, { terminalHandoff })
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })

        const isOptionSelected = (title: string) => {
          const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
          return spans.some(
            (span) => span.text.trimStart().startsWith(title) && (span.attributes & TextAttributes.BOLD) !== 0,
          )
        }
        const command = async () => {
          await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable, {
            maxPasses: 600,
          })
          await setup.mockInput.typeText("/kilo-settings")
          await setup.waitFor(
            () => Boolean(setup.renderer.currentFocusedEditor?.plainText.includes("/kilo-settings")),
            { maxPasses: 600 },
          )
          setup.mockInput.pressEnter()
          await setup.waitForFrame(
            (frame) => frame.includes("Select a configuration scope") && frame.includes("Project"),
            { maxPasses: 600 },
          )
          await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable, { maxPasses: 600 })
        }
        const select = async (option: string, expected: (frame: string) => boolean) => {
          await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable, { maxPasses: 600 })
          await setup.mockInput.typeText(option)
          await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === option, { maxPasses: 600 })
          await setup.waitFor(() => isOptionSelected(option), { maxPasses: 600 })
          setup.mockInput.pressEnter()
          await setup.waitForFrame(expected, { maxPasses: 600 })
        }
        const prompt = async (title: string) => {
          await select(title, (frame) => !frame.includes("Select a setting") && frame.includes(title))
          await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable, {
            maxPasses: 600,
          })
        }
        const scope = async (title = "Profile") => {
          await command()
          await select(title, (frame) => frame.includes("Select a setting"))
        }
        const settled = async (message: string) => {
          await setup.waitForFrame((frame) => frame.includes(message), { maxPasses: 600 })
        }

        // 1. An unwritable scope is offered and explains itself instead of hiding.
        if (!project) {
          await command()
          await select("Project", (frame) => frame.includes("Project configuration is disabled"))
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => !frame.includes("Project configuration is disabled"), { maxPasses: 600 })
        }

        // 2. Prompt-driven integer edit of a field the profile does not define.
        await scope()
        await prompt("Tool output byte limit")
        await setup.mockInput.typeText("4096")
        await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "4096", { maxPasses: 600 })
        setup.mockInput.pressEnter()
        await settled("Tool output byte limit updated in the profile scope.")

        // 3. Choice-driven boolean edit.
        await scope()
        await select("Snapshots", (frame) => frame.includes("Current in profile"))
        await select("Disabled", (frame) => frame.includes("Snapshots updated in the profile scope."))

        // 4. Reset through the same dialog.
        await scope()
        await select("Snapshots", (frame) => frame.includes("Current in profile: false"))
        await select("Unset", (frame) => frame.includes("Snapshots removed from the profile scope."))

        // Native compaction budgets allow zero; output limits still require a positive value.
        await scope()
        await prompt("Compaction token buffer")
        await setup.mockInput.typeText("0")
        await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "0", { maxPasses: 600 })
        setup.mockInput.pressEnter()
        await settled("Compaction token buffer updated in the profile scope.")

        // 5. The Kilo-only training-model toggle edits the raw profile key.
        await scope()
        await select("Hide prompt-training models", (frame) => frame.includes("Current in profile"))
        await select(
          "Enabled",
          (frame) => !frame.includes("Current in profile") && frame.includes("Hide prompt-training models updated"),
        )

        const snapshot = await rpc.read({}, { location })
        assert.deepEqual(field(snapshot, "tool_output.max_bytes").values, { profile: 4096 })
        assert.deepEqual(field(snapshot, "tool_output.max_lines").values, { profile: 123 })
        assert.deepEqual(field(snapshot, "snapshots").values, {})
        assert.equal(field(snapshot, "snapshots").source, "unset")
        assert.deepEqual(field(snapshot, "compaction.buffer").values, { profile: 0 })
        assert.deepEqual(field(snapshot, "hide_prompt_training_models").values, { profile: true })

        // The document keeps every unrelated key the UI never touched.
        const stored = (await Bun.file(input.config).json()) as Record<string, unknown>
        assert.equal(stored["default_agent"], "build")
        assert.deepEqual(stored["tool_output"], { max_lines: 123, max_bytes: 4096 })
        assert.equal(Object.hasOwn(stored, "snapshots"), false)
        assert.deepEqual(stored["compaction"], { auto: false, keep: { tokens: 512 }, buffer: 0 })
        assert.equal(stored["hide_prompt_training_models"], true)

        if (!project) {
          // Project writes stay refused without the host opt-in.
          await assert.rejects(rpc.set({ scope: "project", key: "snapshots", value: true }, { location }))
        }
        if (project) {
          // The same field editor targets the selected scope, then reset reveals
          // the untouched profile value. Leave a project override for restart.
          for (const value of ["640", "", "768"]) {
            await scope("Project")
            await prompt("Image width limit")
            setup.mockInput.pressKey("a", { ctrl: true })
            setup.mockInput.pressKey("k", { ctrl: true })
            await setup.mockInput.typeText(value)
            await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === value, { maxPasses: 600 })
            setup.mockInput.pressEnter()
            await settled(`Image width limit ${value ? "updated in" : "removed from"} the project scope.`)
            const current = field(await rpc.read({}, { location }), "media.image.max_width")
            assert.deepEqual(current.values, value ? { profile: 1024, project: Number(value) } : { profile: 1024 })
            assert.equal(current.source, value ? "project" : "profile")
          }
        }

        const after = await client.session.list({ directory })
        assert.equal(after.data.length, 0)
        for (const session of after.data)
          assert.deepEqual(await client.session.inbox.list({ sessionID: session.id }), [])

        await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable, { maxPasses: 600 })
        await setup.mockInput.typeText("/exit")
        await setup.waitFor(() => Boolean(setup.renderer.currentFocusedEditor?.plainText.includes("/exit")), {
          maxPasses: 600,
        })
        setup.mockInput.pressEnter()
        await closed.promise
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

function field(snapshot: SettingsSnapshot, key: SettingsFieldKey) {
  const found = snapshot.fields.find((item) => item.key === key)
  assert(found, `missing settings field: ${key}`)
  return found
}

try {
  await task
  assert.equal(setup.renderer.isDestroyed, true)
  if (project) {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* launch(input, { models: false, recover: false, projectConfig: true })
          const client = createClient({
            baseUrl: endpoint.url,
            headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
          })
          const location = { directory: process.cwd() }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          const entries = yield* Effect.promise(() => client.config.get({ location }))
          const widths = entries.flatMap((entry) =>
            entry.type === "document" && entry.info.media?.image?.max_width !== undefined
              ? [entry.info.media.image.max_width]
              : [],
          )
          assert.deepEqual(widths, [1024, 768], "restarted host loads profile then project image settings")
          const snapshot = yield* Effect.promise(() => client.rpc(SettingsRpc.Definition).read({}, { location }))
          assert.deepEqual(field(snapshot, "media.image.max_width").values, { profile: 1024, project: 768 })
          assert.equal(field(snapshot, "media.image.max_width").source, "project")
          assert.equal((yield* Effect.promise(() => client.session.list(location))).data.length, 0)
        }),
      ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
    )
  }
  console.log("TUI_SETTINGS_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
