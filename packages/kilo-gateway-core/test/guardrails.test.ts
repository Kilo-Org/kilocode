import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { KiloGuardrails } from "../src/index.js"
import { fixture } from "../src/testing.js"

const policy = {
  mcp: {
    enforcement: "enforce",
    allowedServers: [
      { identityKey: "remote:https://mcp.example.com/mcp", name: "Example", description: null, config: { kind: "remote", url: "https://mcp.example.com/mcp" } },
      {
        identityKey: "npm:@acme/server",
        name: "Acme",
        description: "Acme tools",
        config: { kind: "package", ecosystem: "npm", identifier: "@acme/server", min_version: "2.0.0" },
      },
    ],
  },
  inputScan: { enabled: false, scanToolResults: false },
  skill: { enabled: false, scanBeforeUse: true },
}

test("reads the organization's MCP policy and ignores the rest", async () => {
  using backend = fixture()
  backend.state.guardrails = policy
  const result = await Effect.runPromise(KiloGuardrails.policy(backend.url, "token", "selected", "1.0.0"))
  expect(result?.mcp.enforcement).toBe("enforce")
  expect(result?.mcp.allowedServers.map((server) => server.identityKey)).toEqual([
    "remote:https://mcp.example.com/mcp",
    "npm:@acme/server",
  ])
  expect(backend.requests).toEqual([
    { method: "GET", path: "/api/organizations/selected/guardrails", authorization: "Bearer token", organizationID: "selected" },
  ])
})

test("treats a missing organization as no policy but any other failure as an error", async () => {
  using backend = fixture()
  backend.state.guardrailsStatus = 404
  expect(await Effect.runPromise(KiloGuardrails.policy(backend.url, "token", "selected"))).toBeUndefined()
  for (const status of [401, 403, 500]) {
    backend.state.guardrailsStatus = status
    expect(Exit.isFailure(await Effect.runPromiseExit(KiloGuardrails.policy(backend.url, "token", "selected")))).toBe(true)
  }
  backend.state.guardrailsStatus = 200
  backend.state.guardrails = { mcp: { enforcement: "sometimes", allowedServers: [] } }
  expect(Exit.isFailure(await Effect.runPromiseExit(KiloGuardrails.policy(backend.url, "token", "selected")))).toBe(true)
})

test("reports connections in batches the cloud accepts", async () => {
  using backend = fixture()
  const connections = Array.from({ length: KiloGuardrails.MAX_REPORT_CONNECTIONS + 1 }, (_, index) => ({
    target: { kind: "remote" as const, url: `https://mcp.example.com/${index}` },
    serverName: `server-${index}`,
  }))
  const results = await Effect.runPromise(
    KiloGuardrails.report(backend.url, "token", "selected", { client: "cli", connections }),
  )
  expect(results.map((batch) => batch.results.length)).toEqual([KiloGuardrails.MAX_REPORT_CONNECTIONS, 1])
  expect(backend.state.connectionBodies).toHaveLength(2)
  expect(backend.state.connectionBodies[0]).toMatchObject({ client: "cli" })
  expect(backend.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /api/organizations/selected/guardrails/mcp-connections",
    "POST /api/organizations/selected/guardrails/mcp-connections",
  ])
})

test("fails a report the cloud refuses", async () => {
  using backend = fixture()
  backend.state.connectionsStatus = 400
  const exit = await Effect.runPromiseExit(
    KiloGuardrails.report(backend.url, "token", "selected", {
      client: "cli",
      connections: [{ target: { kind: "remote", url: "https://mcp.example.com/mcp" } }],
    }),
  )
  expect(Exit.isFailure(exit)).toBe(true)
})

test("reports the client product from the platform", () => {
  expect(KiloGuardrails.client({})).toBe("cli")
  expect(KiloGuardrails.client({ KILO_PLATFORM: "vscode" })).toBe("vscode")
  expect(KiloGuardrails.client({ KILO_PLATFORM: "unknown" })).toBe("cli")
})
