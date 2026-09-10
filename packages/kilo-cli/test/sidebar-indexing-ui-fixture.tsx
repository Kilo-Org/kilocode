import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { IndexingRpc } from "../src/indexing-rpc"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const scenario = process.env.TUI_INDEXING_SCENARIO
assert(scenario === "disabled" || scenario === "progress")

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()

// Local embedding service speaking the OpenAI /embeddings shape over loopback
// with deterministic hashed vectors, so the real engine scans, embeds, and
// completes through the real transport without paid inference. While held,
// each batch response is delayed, which keeps the background initial scan In
// Progress until the fixture releases the gate.
const DIMENSION = 256
const gate = {
  held: scenario === "progress",
  release: Promise.withResolvers<void>(),
}
const embeddings = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    if (!request.url.endsWith("/embeddings")) return new Response("not found", { status: 404 })
    const body = (await request.json()) as { input: string[] | string }
    const texts = Array.isArray(body.input) ? body.input : [body.input]
    // The one-input call is the embedder's own endpoint validation probe and
    // must pass; the first multi-input call is a real scan batch, and holding
    // it keeps the background scan In Progress until the fixture releases.
    if (texts.length > 1 && gate.held) {
      gate.held = false
      await Promise.race([gate.release.promise, Bun.sleep(15000)])
    }
    return Response.json({
      data: texts.map((text, index) => ({ embedding: embed(text), index })),
      usage: { prompt_tokens: texts.length, total_tokens: texts.length },
    })
  },
})

function embed(text: string) {
  const vector = new Array<number>(DIMENSION).fill(0)
  for (const token of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    // FNV-1a keeps distinct identifiers in distinct buckets at this dimension.
    let hash = 0x811c9dc5
    for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0
    vector[hash % DIMENSION] += 1
  }
  const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return length === 0 ? vector.map((_, index) => (index === 0 ? 1 : 0)) : vector.map((value) => value / length)
}

function indexingSettings(origin: string) {
  return {
    enabled: true,
    provider: "openai-compatible" as const,
    model: "local-fixture-embed",
    dimension: DIMENSION,
    vectorStore: "lancedb" as const,
    // A full endpoint URL keeps the embedder on its direct-fetch transport.
    "openai-compatible": { baseUrl: `${origin}/v1/embeddings`, apiKey: "local-fixture-key" },
    searchMinScore: 0,
    fileExtensions: [".ts"],
  }
}

// Enough segments across the files to keep the initial scan batching while
// the embedding gate holds the first batch.
const workspaceFiles = Array.from({ length: 12 }, (_, index) => `fixture-module-${index}.ts`)
const fileContent = (index: number) =>
  `// fixture module ${index}\n` +
  Array.from(
    { length: 24 },
    (_, fn) =>
      `export function fixture_${index}_${fn}(value: number) {\n  const scaled = value * ${fn + 1}\n  return scaled + ${index}\n}\n`,
  ).join("\n")

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = layout("interactive")
        if (scenario === "progress") {
          for (const [index, name] of workspaceFiles.entries()) {
            yield* Effect.promise(() => writeFile(path.join(process.cwd(), name), fileContent(index)))
          }
        }
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          ...(scenario === "progress" ? { indexing: indexingSettings(embeddings.url.origin) } : {}),
        })
        const api = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => api.plugin.awaitActivation({ location }))
        const rpc = api.rpc(IndexingRpc)
        if (scenario === "progress") {
          // The real engine scans the activated location in the background;
          // the held first embedding batch keeps that scan In Progress with
          // file counts reported, so the producer state is deterministic
          // before any renderer is involved.
          const deadline = Date.now() + 30_000
          let status = yield* Effect.promise(() => rpc.status({}, { location }))
          while (Date.now() < deadline && !(status.state === "In Progress" && status.totalFiles > 0)) {
            yield* Effect.promise(() => Bun.sleep(200))
            status = yield* Effect.promise(() => rpc.status({}, { location }))
          }
          assert.equal(status.state, "In Progress", `engine status while the scan is held: ${JSON.stringify(status)}`)
          assert(status.totalFiles > 0, "the scan discovered the workspace files")
        } else {
          const status = yield* Effect.promise(() => rpc.status({}, { location }))
          assert.equal(status.state, "Disabled")
          assert.equal(status.totalFiles, 0)
        }
        const session = yield* Effect.promise(() => api.session.create({ title: "Indexing sidebar fixture", location }))
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, {
            args: { sessionID: session.id },
            terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve }),
          }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.promise(async () => {
          await Promise.race([
            ready.promise,
            closed.promise.then(() => {
              throw new Error("TUI closed before handoff")
            }),
          ])
          if (scenario === "disabled") {
            await setup.waitForFrame((frame) => /Code Indexing[ \t█]*\n\s*Disabled\b/.test(frame), { maxPasses: 600 })
            assert.equal(await Bun.file(path.join(input.paths.state, "indexing")).exists(), false)
            assert.deepEqual((await api.message.list({ sessionID: session.id })).data, [])
            assert.deepEqual(await api.session.inbox.list({ sessionID: session.id }), [])
            // No global/default-location fallback should be needed to keep the section visible.
            setup.resize(140, 45)
            // A narrow sidebar can put its scrollbar after the heading. It is
            // renderer chrome, not part of the indexing label or state.
            await setup.waitForFrame((frame) => /Code Indexing[ \t█]*\n\s*Disabled\b/.test(frame), { maxPasses: 600 })
          }
          if (scenario === "progress") {
            // The first poll renders the live In Progress state with the real
            // per-file counts the engine reported while the batch was held.
            await setup.waitForFrame(
              (frame) =>
                /Code Indexing[ \t█]*\n\s*In Progress\b/.test(frame) && /\d+ \/ \d+ files \(\d+%\)/.test(frame),
              { maxPasses: 600 },
            )
            // Release the held batch: the real engine finishes the scan and
            // the section reconciles to Complete without the progress line.
            gate.release.resolve()
            await setup.waitForFrame(
              (frame) => /Code Indexing[ \t█]*\n\s*Complete\b/.test(frame) && !/files \(\d+%\)/.test(frame),
              { maxPasses: 600 },
            )
            assert((await stat(path.join(input.paths.state, "indexing"))).isDirectory())
          }
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log(`TUI_INDEXING_${scenario.toUpperCase()}_OK`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await embeddings.stop(true)
}
