import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { run } from "../src/context"
import { assertNetwork, decorateHttpClient } from "../src/network"
import type { Profile } from "../src/profile"
import { CurrentProxyFactory, startProxy, type ProxyFactory } from "../src/proxy"

function profile(mode: Profile["network"]["mode"]): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: process.cwd(), kind: "subtree" }],
      denyWrite: [],
      denyNames: [".git"],
    },
    network: { mode, allowedHosts: mode === "proxy" ? ["example.com"] : [] },
    environment: { deny: [], set: {} },
  }
}

function server() {
  const paths: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      return new Response(path)
    },
  })
  return { server, paths }
}

describe("sandbox in-process network capability", () => {
  test("keeps concurrent allow, deny, and control-plane requests call-local", async () => {
    const http = server()
    try {
      const effect = Effect.gen(function* () {
        const raw = yield* HttpClient.HttpClient
        const guarded = decorateHttpClient(raw)
        return yield* Effect.all(
          {
            denied: run(profile("deny"), guarded.get(new URL("/denied", http.server.url))).pipe(Effect.result),
            allowed: run(
              profile("allow"),
              Effect.flatMap(guarded.get(new URL("/allowed", http.server.url)), (response) => response.text),
            ),
            control: run(
              profile("deny"),
              Effect.flatMap(raw.get(new URL("/control", http.server.url)), (response) => response.text),
            ),
          },
          { concurrency: "unbounded" },
        )
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const result = await Effect.runPromise(effect)
      expect(Result.isFailure(result.denied)).toBe(true)
      if (Result.isFailure(result.denied)) {
        expect(result.denied.failure.message).toContain("Sandbox denied outbound network access")
      }
      expect(result.allowed).toBe("/allowed")
      expect(result.control).toBe("/control")
      expect(http.paths.sort()).toEqual(["/allowed", "/control"])
    } finally {
      await http.server.stop(true)
    }
  })

  test("fails closed when allowedHosts is set outside proxy mode", async () => {
    for (const mode of ["allow", "deny"] as const) {
      const input = profile(mode)
      const result = await Effect.runPromise(
        run(
          { ...input, network: { mode, allowedHosts: ["example.com"] } },
          assertNetwork("https://example.com", "testRequest"),
        ).pipe(Effect.result),
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain("allowedHosts require proxy network mode")
      }
    }
  })

  test("routes supported HTTP requests through proxy mode and denies opaque capability", async () => {
    const http = server()
    try {
      const port = http.server.port!
      const factory: ProxyFactory = (hosts) =>
        startProxy(hosts, process.platform, async () => ({ address: "127.0.0.1", family: 4 }))
      const input = {
        ...profile("proxy"),
        network: { mode: "proxy" as const, allowedHosts: [`allowed.test:${port}`] },
      }
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const raw = yield* HttpClient.HttpClient
          const guarded = decorateHttpClient(raw)
          return yield* Effect.all({
            capability: run(input, assertNetwork("https://allowed.test/path", "testRequest")).pipe(
              Effect.result,
            ),
            request: run(
              input,
              Effect.flatMap(guarded.get(`http://allowed.test:${port}/proxy`), (response) => response.text),
            ).pipe(Effect.result),
          })
        }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(CurrentProxyFactory, factory)),
      )
      expect(Result.isFailure(result.capability)).toBe(true)
      if (Result.isFailure(result.capability)) {
        expect(result.capability.failure.reason._tag).toBe("PermissionDenied")
        expect(result.capability.failure.message).toContain("Sandbox denied outbound network access")
        expect(result.capability.failure.message).toContain("https://allowed.test")
        expect(result.capability.failure.message).not.toContain("/path")
      }
      expect(result.request).toEqual(Result.succeed("/proxy"))
      expect(http.paths).toEqual(["/proxy"])
    } finally {
      await http.server.stop(true)
    }
  })
})
