import { expect, test } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Environment } from "@opencode/core/environment/index"
import { authFailure } from "@opencode/core/kilocode/mcp/auth-failure"
import { McpConnection } from "@opencode/core/mcp/connection"
import { Effect } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"

/**
 * Connects once to a remote endpoint that answers every request with `status` and reports the
 * failure the connection classified.
 */
const classify = async (input: { status: number; oauth?: boolean; host?: boolean }) => {
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: input.status }),
  })
  const failures: McpConnection.Failure[] = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const environment = yield* Environment.Service
        const connection = McpConnection.make({
          name: "fixture",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: new URL("/mcp", server.url).toString(),
            ...(input.oauth === false ? { oauth: false } : {}),
          }),
          directory: import.meta.dir,
          host: input.host === false ? undefined : { authFailure },
          authProvider: Effect.succeed(undefined),
          elicitation: { create: () => Effect.die("unexpected elicitation"), complete: () => Effect.void },
          environment,
          fetch: globalThis.fetch,
          scope: yield* Effect.scope,
          lock: (effect) => effect,
          callbacks: () => undefined,
          fork: () => undefined,
          events: {
            connecting: Effect.void,
            connected: Effect.void,
            failed: (failure) => Effect.sync(() => failures.push(failure)),
            settled: Effect.void,
            closed: () => Effect.void,
            changed: () => Effect.void,
          },
        })
        yield* connection.start
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer), Effect.timeout("10 seconds")),
  )
  return failures
}

test("classifies a remote authentication failure as needs_auth with the original error", async () => {
  const failures = await classify({ status: 403 })
  expect(failures).toHaveLength(1)
  expect(failures[0]?.status).toBe("needs_auth")
  expect(failures[0]?.error).toContain("403")
})

test("leaves OAuth-disabled remote authentication failures failed", async () => {
  const failures = await classify({ status: 403, oauth: false })
  expect(failures).toHaveLength(1)
  expect(failures[0]?.status).toBe("failed")
  expect(failures[0]?.error).toContain("403")
})

test("leaves non-authentication remote failures failed", async () => {
  for (const status of [404, 500]) {
    const failures = await classify({ status })
    expect(failures).toHaveLength(1)
    expect(failures[0]?.status).toBe("failed")
  }
})

test("keeps the upstream classification without a host", async () => {
  const failures = await classify({ status: 403, host: false })
  expect(failures).toHaveLength(1)
  expect(failures[0]?.status).toBe("failed")
})
