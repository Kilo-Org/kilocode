import { Cause, Effect, Exit, Layer } from "effect"
import { expect } from "bun:test"
import { HttpClient } from "effect/unstable/http"
import { ProjectID } from "@/project/schema"
import { InstanceRef } from "@/effect/instance-ref"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

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

restricted.live("keeps network restriction enabled by default", () => {
  const target = server()
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const exit = yield* SandboxPolicy.execute(http.get(target.server.url)).pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.exit,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
    expect(target.requests()).toBe(0)
  }).pipe(Effect.ensuring(Effect.promise(() => target.server.stop(true))))
})

open.live("allows tool network traffic when network restriction is disabled", () => {
  const target = server()
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const response = yield* SandboxPolicy.execute(http.get(target.server.url)).pipe(
      Effect.provideService(InstanceRef, ctx),
    )
    expect(yield* response.text).toBe("sandbox-config-ok")
    expect(target.requests()).toBe(1)
  }).pipe(Effect.ensuring(Effect.promise(() => target.server.stop(true))))
})
