import { expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Session } from "../../src/session/session"
import { SessionShare } from "../../src/share/session"
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Auth.defaultLayer, Storage.defaultLayer, CrossSpawnSpawner.defaultLayer, RuntimeFlags.layer()),
)

const layer = SessionShare.layer.pipe(
  Layer.provideMerge(Session.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
)

it.instance("shares and unshares sessions through Kilo public URLs", () => {
  const urls: string[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/share")) return Response.json({ public_id: "public-1" })
      if (url.endsWith("/unshare")) return new Response(null, { status: 200 })
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const share = yield* SessionShare.Service
    const session = yield* Session.Service
    const storage = yield* Storage.Service
    yield* auth.set("kilo", { type: "api", key: "test-token" })

    const info = yield* share.create({ title: "share-test" })
    yield* storage.write(["session_share", info.id], { id: "remote-1", ingestPath: "/api/ingest/session-1" })

    const result = yield* share.share(info.id)
    expect(result.url).toBe("https://app.kilo.ai/s/public-1")
    expect((yield* session.get(info.id)).share?.url).toBe("https://app.kilo.ai/s/public-1")

    yield* share.unshare(info.id)
    expect((yield* session.get(info.id)).share).toBeUndefined()
    expect(urls.some((url) => url.endsWith(`/api/session/${info.id}/share`))).toBe(true)
    expect(urls.some((url) => url.endsWith(`/api/session/${info.id}/unshare`))).toBe(true)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.ignore)
        request.mockRestore()
      }),
    ),
    Effect.provide(layer),
  )
})
