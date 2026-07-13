import { Cause, Effect, Exit, Layer } from "effect"
import { expect, test } from "bun:test"
import { HttpClient } from "effect/unstable/http"
import { backendSupport, CurrentProxyFactory, startProxy, type ProxyFactory } from "@kilocode/sandbox"
import { ProjectID } from "@/project/schema"
import { InstanceRef } from "@/effect/instance-ref"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import { SessionID } from "@/session/schema"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

const tool = ToolNetwork.builtin({ id: "webfetch" })
const ctx = {
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {
    id: ProjectID.make("sandbox-config-network"),
    worktree: process.cwd(),
    vcs: "git" as const,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}

function layer(restrict?: boolean, allowedHosts: string[] = []) {
  return Layer.mergeAll(
    ToolNetwork.httpLayer,
    TestConfig.layer({
      get: () =>
        Effect.succeed({
          sandbox: {
            enabled: true,
            network: restrict === false ? "allow" : "deny",
            allowed_hosts: allowedHosts,
          },
        }),
    }),
  )
}

function server() {
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++
      return new Response("sandbox-config-ok")
    },
  })
  return { server, requests: () => requests }
}

const restricted = testEffect(layer())
const open = testEffect(layer(false))
const supported = process.platform === "win32" ? test.skip : test

supported("allows only configured HTTP destinations through the scoped proxy", async () => {
  const target = server()
  const port = target.server.port!
  const factory: ProxyFactory = (hosts) =>
    startProxy(hosts, process.platform, async (dest) => {
      if (dest.port !== port) throw new Error("unexpected port")
      return { address: "127.0.0.1", family: 4 }
    })
  await Effect.runPromise(Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const sessionID = SessionID.make(`ses_sandbox_config_network_proxy_${Date.now()}`)
    const allowed = yield* SandboxPolicy.executeTool(
      sessionID,
      tool,
      http.get(`http://allowed.test:${port}/allowed`),
    ).pipe(Effect.provideService(InstanceRef, ctx), Effect.exit)
    const denied = yield* SandboxPolicy.executeTool(
      sessionID,
      tool,
      http.get(`http://blocked.allowed.test:${port}/blocked`),
    ).pipe(Effect.provideService(InstanceRef, ctx), Effect.exit)
    expect(Exit.isSuccess(allowed)).toBe(true)
    expect(Exit.isSuccess(denied)).toBe(true)
    if (Exit.isSuccess(denied)) expect(denied.value.status).toBe(403)
    expect(target.requests()).toBe(1)
  }).pipe(
    Effect.provide(layer(true, [`allowed.test:${port}`])),
    Effect.provideService(CurrentProxyFactory, factory),
    Effect.ensuring(Effect.promise(() => target.server.stop(true))),
  ))
})

restricted.live("keeps network restriction enabled by default when the sandbox is available", () => {
  const target = server()
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const sessionID = SessionID.make("ses_sandbox_config_network_restricted")
    const exit = yield* SandboxPolicy.executeTool(sessionID, tool, http.get(target.server.url)).pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.exit,
    )
    if (!backendSupport().available) {
      expect(Exit.isFailure(exit)).toBe(true)
      expect(target.requests()).toBe(0)
      return
    }
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
    expect(target.requests()).toBe(0)
  }).pipe(Effect.ensuring(Effect.promise(() => target.server.stop(true))))
})

open.live("allows network when restriction is disabled without authenticated server control", () => {
  const target = server()
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const sessionID = SessionID.make("ses_sandbox_config_network_open")
    const status = yield* SandboxPolicy.status(sessionID).pipe(Effect.provideService(InstanceRef, ctx))
    const exit = yield* SandboxPolicy.executeTool(sessionID, tool, http.get(target.server.url)).pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.exit,
    )
    if (!backendSupport().available) {
      expect(Exit.isFailure(exit)).toBe(true)
      expect(target.requests()).toBe(0)
      return
    }
    expect(status.enabled).toBe(true)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(target.requests()).toBe(1)
  }).pipe(Effect.ensuring(Effect.promise(() => target.server.stop(true))))
})
