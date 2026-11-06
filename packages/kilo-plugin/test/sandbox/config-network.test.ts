import { afterAll, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import {
  backendSupport,
  CurrentProxyFactory,
  networkHttpLayer,
  startProxy,
  type ProxyFactory,
} from "@kilocode/sandbox"
import { Session } from "@opencode/schema/session"
import * as SandboxPolicy from "../../src/sandbox/policy"
import { cleanup, harness, provide, tempdir } from "./support"

afterAll(cleanup)

const id = (value: string) => Session.ID.make(value)
const http = networkHttpLayer.pipe(Layer.provide(FetchHttpClient.layer))
const sandboxed = backendSupport({ mode: "deny", allowedHosts: [] }).available ? test : test.skip
const open = backendSupport({ mode: "allow", allowedHosts: [] }).available ? test : test.skip
const proxied = backendSupport({ mode: "proxy", allowedHosts: ["allowed.test:443"] }).available ? test : test.skip

function server() {
  let requests = 0
  const value = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++
      return new Response("sandbox-config-ok")
    },
  })
  return { value, requests: () => requests }
}

function body(url: string, blocked: string) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const allowed = yield* client.get(url).pipe(Effect.flatMap((response) => response.text))
    const denied = yield* client.get(blocked)
    return { allowed, denied }
  }).pipe(Effect.provide(http))
}

proxied("allows only configured HTTP destinations through the scoped proxy", async () => {
  const target = server()
  const port = target.value.port!
  const directory = await tempdir()
  const value = harness({
    directory,
    config: {
      sandbox: { enabled: true, network: "deny", allowed_hosts: [`allowed.test:${port}`] },
    },
  })
  const sessionID = id("ses_config_network_proxy")
  const factory: ProxyFactory = (hosts) =>
    startProxy(hosts, process.platform, async (destination) => {
      if (destination.port !== port) throw new Error("unexpected port")
      return { address: "127.0.0.1", family: 4 }
    })

  try {
    const result = await Effect.runPromise(
      provide(
        value,
        SandboxPolicy.executeTool(
          sessionID,
          { id: "webfetch" },
          body(`http://allowed.test:${port}/allowed`, `http://blocked.allowed.test:${port}/blocked`),
        ),
      ).pipe(Effect.provideService(CurrentProxyFactory, factory)),
    )
    expect(result.allowed).toBe("sandbox-config-ok")
    expect(result.denied.status).toBe(403)
    expect(target.requests()).toBe(1)
  } finally {
    await target.value.stop(true)
  }
})

sandboxed("denies every destination when the configured network is denied", async () => {
  const target = server()
  const directory = await tempdir()
  const value = harness({ directory, config: { sandbox: { enabled: true, network: "deny" } } })
  const sessionID = id("ses_config_network_deny")

  try {
    const exit = await Effect.runPromise(
      provide(
        value,
        SandboxPolicy.executeTool(
          sessionID,
          { id: "webfetch" },
          body(target.value.url.toString(), target.value.url.toString()).pipe(Effect.exit),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
    expect(target.requests()).toBe(0)
  } finally {
    await target.value.stop(true)
  }
})

open("allows network when the configured restriction is disabled", async () => {
  const target = server()
  const directory = await tempdir()
  const value = harness({ directory, config: { sandbox: { enabled: true, network: "allow" } } })
  const sessionID = id("ses_config_network_allow")
  const status = await Effect.runPromise(provide(value, SandboxPolicy.status(sessionID)))
  if (!status.available) return

  try {
    const result = await Effect.runPromise(
      provide(
        value,
        SandboxPolicy.executeTool(
          sessionID,
          { id: "webfetch" },
          Effect.gen(function* () {
            const client = yield* HttpClient.HttpClient
            return yield* client.get(target.value.url.toString()).pipe(Effect.flatMap((response) => response.text))
          }).pipe(Effect.provide(http)),
        ),
      ),
    )
    expect(result).toBe("sandbox-config-ok")
    expect(target.requests()).toBe(1)
  } finally {
    await target.value.stop(true)
  }
})
