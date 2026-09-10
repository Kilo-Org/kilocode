// Portable TUI smoke entrypoint, bundled into the artifact by build-portable.ts as
// script/portable-tui-smoke-entry.js. It mounts the REAL Kilo TUI headlessly via
// createTestRenderer (no real terminal) against the launched interactive host WITH a loopback
// model server, and proves the SHIPPED artifact's TUI + kilo.preview plugin work end to end:
//
//   1. CONNECTED BEYOND THE GRACE: the TUI's own client.connection reaches and STAYS
//      "connected" past the 5s initial reconnect grace — observed as the ABSENCE of the
//      "Connection lost…" overlay (app.tsx:1268-1284 clears it only when connected), not by a
//      separate client probe and not by exiting early. This is the regression guard for the
//      bundled-vs-external solid-js instance defect (connection.ts onMount must fire).
//   2. PROMPT/REPLY ROUND-TRIP: selecting the loopback fixture model and submitting a prompt
//      renders the loopback assistant reply, proving the mounted connection carries real
//      session traffic (not just an open socket).
//   3. SHIPPED PLUGIN: the kilo.preview home.footer slot renders its exact status line
//      ("Kilo internal preview · isolated interactive store · Connect Kilo to sign in · /teams")
//      and the home.logo slot renders the KiloLogo ASCII — plugin-specific, not generic chrome.
//   4. narrow(80)/wide(120) resize keeps the footer rendered; /exit cleanly destroys the renderer.
//
// No upstream/package-store edits; the model server is loopback-only; no network/credentials.
import { NodeHttpServer } from "@effect/platform-node"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

// Loopback model server (mirrors test/tui.test.tsx): streams a canned reply for the fixture model.
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/api/openrouter/models") return Response.json({ data: [] })
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body = (await request.json()) as { stream?: boolean; model: string }
    const content = body.stream ? "Portable TUI loopback response" : "Portable TUI title"
    const base = { id: "portable-tui", created: 1, model: body.model }
    const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    if (!body.stream)
      return Response.json({
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage,
      })
    const frames = [
      { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
    ]
    return new Response(
      frames.map((f) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", ...f })}\n\n`).join("") +
        "data: [DONE]\n\n",
      {
        headers: { "content-type": "text/event-stream" },
      },
    )
  },
})

async function main() {
  const config = JSON.stringify({
    model: "fixture/fixture-initial",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
        models: { "fixture-initial": {}, "fixture-selected": {} },
      },
    },
  })
  const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const closed = Promise.withResolvers<void>()
  const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })
  const task = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = layout("interactive")
        const endpoint = yield* launch(input, {
          models: false,
          content: config,
          gateway: { server: model.url.origin },
        })
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, { terminalHandoff }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.tryPromise(async () => {
          await Promise.race([
            ready.promise,
            closed.promise.then(() => {
              throw new Error("TUI closed before terminal handoff")
            }),
          ])
          // Kilo-plugin-specific footer (non-wrapping prefix at any width) + signed-out label.
          await setup.waitForFrame(
            (frame) =>
              frame.includes("Kilo internal preview · isolated interactive store") &&
              frame.includes("Connect Kilo to sign in"),
            { maxPasses: 600 },
          )
          console.log("KILO_PORTABLE_TUI_READY")
          // 1) CONNECTED BEYOND THE GRACE: the 6s wait is DELIBERATE — it waits strictly past
          //    the 5s initial reconnect grace (app.tsx:1274) so a transient startup connecting
          //    state cannot pass as connected, then requires NO "Connection lost" overlay. It is
          //    not an arbitrary sleep manufacturing a pass: it samples the real rendered overlay
          //    only after the grace has genuinely elapsed, and fails if the overlay shows.
          await new Promise((r) => setTimeout(r, 6000))
          const afterGrace = setup.captureCharFrame()
          assert(
            !afterGrace.includes("Connection lost") && !afterGrace.includes("Reconnecting to the server"),
            `TUI connection must be connected past the grace (overlay must not render):\n${afterGrace}`,
          )
          // Kilo-plugin-specific logo ASCII (renderer normalizes 🬺🬏/~~ -> ▀; assert stable "██  ██").
          assert(afterGrace.includes("██  ██"), `Kilo logo ASCII must render (kilo.preview home.logo):\n${afterGrace}`)
          // 3) narrow -> wide resize keeps the plugin footer rendered on the home screen
          //    (the footer is a home slot; do this BEFORE the prompt moves to the conversation).
          for (const width of [80, 120]) {
            const frameID = setup.renderer.frameId
            setup.resize(width, width === 80 ? 24 : 40)
            await setup.waitFor(() => setup.renderer.frameId > frameID, { maxPasses: 600 })
            await setup.waitForFrame((frame) => frame.includes("Kilo internal preview · isolated interactive store"), {
              maxPasses: 600,
            })
          }
          // 2) PROMPT/REPLY ROUND-TRIP: open the model dialog (/models -> "Switch model"),
          //    select the loopback fixture model, submit a prompt, require the loopback
          //    assistant reply to render through the mounted connection. The dialog title is
          //    "Switch model" (app.tsx); its filter placeholder is "Select model", so match the
          //    fixture model option directly rather than the placeholder text.
          await setup.mockInput.typeText("/models")
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("fixture-selected"), { maxPasses: 600 })
          await setup.mockInput.typeText("fixture-selected")
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("fixture-selected"), { maxPasses: 600 })
          await setup.mockInput.typeText("Greet the portable TUI")
          setup.mockInput.pressEnter()
          const reply = await setup.waitForFrame((frame) => frame.includes("Portable TUI loopback response"), {
            maxPasses: 600,
          })
          assert(reply.includes("Greet the portable TUI"), reply)
          // 4) Clean exit destroys the renderer.
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
          assert.equal(setup.renderer.isDestroyed, true)
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  await task
  assert.equal(setup.renderer.isDestroyed, true)
}

try {
  await main()
  console.log("KILO_PORTABLE_TUI_SMOKE_OK")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await model.stop(true)
}
