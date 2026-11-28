import { expect } from "bun:test"
import { Effect, Exit } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Images from "@/kilocode/image-generation"
import * as Network from "@/kilocode/sandbox/network"
import { testEffect } from "../lib/effect"

const it = testEffect(Network.httpLayer)

it.live("discovers image models with the configured token and reports unavailable catalogs", () =>
  Effect.gen(function* () {
    const tokens: (string | null)[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch(request) {
            tokens.push(request.headers.get("authorization"))
            if (new URL(request.url).pathname !== "/v1/models") return new Response(null, { status: 404 })
            return Response.json({
              data: [
                { id: "gufo", capability: "image" },
                { id: "chat", capability: "text" },
                { id: "compatible", name: "Compatible server" },
                { id: "gufo", capability: "image" },
              ],
            })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const http = yield* HttpClient.HttpClient
    const target = { url: `${server.url}v1`, key: "custom-token", model: undefined }
    expect(yield* Images.models(http, target)).toEqual([
      { id: "gufo", name: "gufo", description: undefined },
      { id: "compatible", name: "Compatible server", description: undefined },
    ])
    expect(tokens.at(0)).toBe("Bearer custom-token")
    expect(
      Exit.isFailure(yield* Images.models(http, { ...target, url: `${server.url}missing` }).pipe(Effect.exit)),
    ).toBe(true)
  }))
