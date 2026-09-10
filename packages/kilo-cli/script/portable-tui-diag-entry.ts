// DIAGNOSTIC (temporary, not shipped): mount the REAL Kilo TUI headlessly WITH a loopback
// model server (mirroring the proven source tui-fixture conversation flow), keep it open
// >5s past the reconnect grace, and report the ACTUAL mounted-TUI connection state — proving
// or disproving a real connection defect rather than masking it behind an early-exit
// predicate or a separate client probe.
//
// It observes the mounted TUI's connection through the real render seam:
//   - the Reconnecting overlay ("Connection lost…") renders iff client.connection.status() !==
//     "connected" for >5s initial / >1s reconnecting (app.tsx:1261-1284 clears it when connected);
//   - a successful prompt round-trip (submit -> assistant reply rendered) REQUIRES the mounted
//     connection to be connected and the model catalog loaded;
//   - a public client model.list against the SAME host corroborates the host is serving.
// No arbitrary sleep manufactures a pass: the assertions read rendered connection state and a
// real prompt round-trip after the >5s grace has elapsed.
import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

// Loopback model server (mirrors test/tui.test.tsx): streams a canned reply for the fixture model.
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body = (await request.json()) as { stream?: boolean; model: string }
    const content = body.stream ? "Diag TUI response" : "Diag TUI title"
    const base = { id: "diag-tui", created: 1, model: body.model }
    const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    if (!body.stream)
      return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage })
    const frames = [
      { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
    ]
    return new Response(frames.map((f) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", ...f })}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
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
        const endpoint = yield* launch(input, { models: false, content: config })
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, { terminalHandoff }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.tryPromise(async () => {
          await Promise.race([ready.promise, closed.promise.then(() => { throw new Error("TUI closed before handoff") })])
          // Wait for the footer so the app is up, THEN observe connection state past the >5s grace.
          await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })
          // Public client on the SAME host: is the model catalog serving?
          const api = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
          const catalog = await api.model.list({ location: { directory: process.cwd() } }).then(
            (r) => `catalog models=${r.data.length} fixture=${r.data.filter((m) => m.providerID === "fixture").map((m) => m.id).join(",")}`,
            (e) => `catalog ERROR ${String((e as Error)?.message ?? e)}`,
          )
          process.stderr.write(`TUI_DIAG ${catalog}\n`)
          // Observe the mounted connection across the >5s reconnect grace WITHOUT a masking predicate:
          // sample the frame for the overlay at t≈2s and t≈7s (initial grace is 5s).
          await new Promise((r) => setTimeout(r, 2000))
          const early = setup.captureCharFrame()
          process.stderr.write(`TUI_DIAG t2s overlay=${early.includes("Connection lost") || early.includes("Reconnecting")}\n`)
          await new Promise((r) => setTimeout(r, 5000))
          const late = setup.captureCharFrame()
          process.stderr.write(`TUI_DIAG t7s overlay=${late.includes("Connection lost") || late.includes("Reconnecting")}\n`)
          process.stderr.write(`TUI_DIAG t7s FRAME:\n${late}\n`)
          // Prove the mounted connection: submit a prompt and require the assistant reply to render.
          await setup.mockInput.typeText("Say connected")
          setup.mockInput.pressEnter()
          const reply = await setup
            .waitForFrame((frame) => frame.includes("Diag TUI response"), { maxPasses: 600 })
            .then(() => true, () => false)
          process.stderr.write(`TUI_DIAG promptRoundTrip=${reply} overlayAtReply=${(setup.captureCharFrame()).includes("Connection lost")}\n`)
          // Replicate connection.ts connect() EXACTLY against this host: subscribe with a
          // request.signal that aborts on connectTimeout=2000, require first event ===
          // server.connected within that window. Reports the exact transition the mounted
          // connection's state machine would record.
          const connectProbe = await (async () => {
            const request = new AbortController()
            const timeout = setTimeout(() => request.abort(new Error("Timed out connecting to server")), 2000)
            try {
              const probeApi = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
              const it = probeApi.event.subscribe({ signal: request.signal })[Symbol.asyncIterator]()
              const first = await it.next()
              clearTimeout(timeout)
              if (first.done) return `connect(): first.done reason=${String(request.signal.reason)}`
              if ((first.value as { type?: string }).type !== "server.connected") return `connect(): first=${String((first.value as { type?: string }).type)} NOT server.connected`
              return "connect(): server.connected OK (would set status=connected)"
            } catch (e) {
              clearTimeout(timeout)
              return `connect(): THREW ${String((e as Error)?.message ?? e)} reason=${String(request.signal.reason)}`
            }
          })()
          process.stderr.write(`TUI_DIAG ${connectProbe}\n`)
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  await task
}

try {
  await main()
  console.log("TUI_DIAG_DONE")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await model.stop(true)
}
