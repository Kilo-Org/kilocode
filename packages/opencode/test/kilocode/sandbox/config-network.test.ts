import { Cause, Effect, Exit, Layer } from "effect"
import { expect } from "bun:test"
import { HttpClient } from "effect/unstable/http"
import { backendSupport } from "@kilocode/sandbox"
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

function layer(restrict?: boolean) {
  return Layer.mergeAll(
    ToolNetwork.httpLayer,
    TestConfig.layer({
      get: () =>
        Effect.succeed({
          experimental: {
            sandbox: true,
            sandbox_restrict_network: restrict,
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
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(target.requests()).toBe(1)
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
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(target.requests()).toBe(1)
      return
    }
    expect(status.enabled).toBe(true)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(target.requests()).toBe(1)
  }).pipe(Effect.ensuring(Effect.promise(() => target.server.stop(true))))
})
