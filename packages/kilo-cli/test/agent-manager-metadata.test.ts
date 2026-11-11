import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

const metadata = { agentManager: { requestID: "amr_metadata_1" }, replyTo: "amr_metadata_1" }

const provider = {
  test: {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: "http://127.0.0.1:9/v1", apiKey: "test-key" },
    models: { large: { name: "Large" }, small: { name: "Small" } },
  },
}

const boot =
  (body: (client: ReturnType<typeof OpenCode.make>, directory: string) => Promise<void>) => async () => {
    using backend = fixture()
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-agent-manager-metadata-"))
    const directory = path.join(root, "repo")
    await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify({ model: "test/large", provider }))
    const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
    process.env.KILO_API_URL = backend.url
    delete process.env.KILO_API_KEY
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: false },
                  config: { directory: path.join(root, "global"), project: true },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            yield* Effect.promise(() => body(client, directory))
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
      )
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      await rm(root, { recursive: true, force: true })
    }
  }

test(
  "prompt metadata reaches the projected user message",
  boot(async (client, directory) => {
    const session = await client.session.create({
      location: { directory },
      title: "Metadata",
      model: { providerID: "test", id: "large" },
    })
    const admitted = await client.session.prompt({
      sessionID: session.id,
      text: "hello",
      metadata,
      resume: false,
    })
    expect(admitted.payload.metadata).toEqual(metadata)

    // Admission alone leaves the message pending; the inbox row keeps the metadata across that boundary.
    expect(await client.session.inbox.list({ sessionID: session.id })).toHaveLength(1)

    // A wake delivers the pending row, and the projector copies the metadata to the durable user message.
    await client.session.prompt({ sessionID: session.id, text: "wake", resume: true })
    const message = await waitFor(async () => {
      const context = await client.session.context({ sessionID: session.id })
      return context.find((item) => item.type === "user" && item.metadata?.agentManager !== undefined)
    })
    await client.session.interrupt({ sessionID: session.id })

    expect(message.type).toBe("user")
    expect(message.metadata).toEqual(metadata)
    expect("text" in message && message.text).toBe("hello")
  }),
  30_000,
)

async function waitFor<T>(read: () => Promise<T | undefined>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(50)
  }
  throw new Error("timed out waiting for the delivered message")
}
