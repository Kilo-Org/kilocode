import { expect, test } from "bun:test"
import type { InitializeRequest, InitializeResponse } from "@agentclientprotocol/sdk"
import { ACPCapabilities } from "@opencode/cli/acp/capabilities"
import { ACPService } from "@opencode/cli/acp/service"
import { Effect, Exit, Ref } from "effect"
import { KiloACP } from "../src/acp-service"

const input = { protocolVersion: 1 }

function makeService() {
  const capabilities = Ref.makeUnsafe(ACPCapabilities.parse(undefined))
  const dependencies = {
    capabilities,
    turn: { prompt: () => Effect.die("unexpected prompt"), cancel: () => Effect.void },
  } as unknown as Parameters<typeof ACPService.make>[0]
  return { capabilities, service: ACPService.make(dependencies) }
}

test("wraps the real ACP service without changing capability or authentication semantics", async () => {
  const { capabilities, service } = makeService()
  const wrapped = KiloACP.wrap(service)
  const requests: InitializeRequest[] = [
    input,
    { ...input, clientCapabilities: { auth: { terminal: true } } },
    { ...input, clientCapabilities: { _meta: { "terminal-auth": true, "opencode/child-session-updates": true } } },
    {
      ...input,
      clientCapabilities: { auth: { terminal: true }, _meta: { "terminal-auth": true } },
    },
  ]
  for (const params of requests) {
    const original = await Effect.runPromise(service.initialize(params))
    const result = await Effect.runPromise(wrapped.initialize(params))
    const expected = structuredClone(original)
    const terminal = expected.authMethods?.[0]?._meta?.["terminal-auth"]
    if (terminal && typeof terminal === "object" && !Array.isArray(terminal)) {
      Object.assign(terminal, { command: "kilo2" })
    }
    expect(result).toEqual(expected)
    expect(await Effect.runPromise(Ref.get(capabilities))).toEqual(ACPCapabilities.parse(params.clientCapabilities))
  }
  for (const key of Object.keys(service) as (keyof ACPService.Interface)[]) {
    if (key !== "initialize") expect(wrapped[key]).toBe(service[key])
  }
  expect(await Effect.runPromise(wrapped.authenticate({ methodId: "opencode-login" }))).toEqual({})
  const originalError = await Effect.runPromise(Effect.exit(service.authenticate({ methodId: "missing" })))
  const wrappedError = await Effect.runPromise(Effect.exit(wrapped.authenticate({ methodId: "missing" })))
  expect(Exit.isFailure(originalError)).toBe(true)
  expect(wrappedError).toEqual(originalError)
})

test("preserves unknown response and auth metadata without mutating it", async () => {
  const { service } = makeService()
  const response = {
    protocolVersion: 1,
    agentCapabilities: {},
    _meta: { other: { value: 1 } },
    authMethods: [
      {
        id: "opencode-login",
        name: "First",
        description: "description",
        _meta: {
          other: [1, 2],
          "terminal-auth": { command: "opencode", args: ["x", "y"], label: "Label", extra: { x: 1 } },
        },
      },
      { id: "opencode-login", name: "Second", _meta: { "terminal-auth": { label: "No command" }, other: true } },
      { id: "opencode-login", name: "Third", _meta: { "terminal-auth": "opaque" } },
      { id: "other-provider", name: "Other", _meta: { "terminal-auth": { command: "opencode" } } },
      { id: "opencode-login", name: "Alternative", _meta: { "terminal-auth": { command: "other-cli" } } },
    ],
  } satisfies InitializeResponse
  const snapshot = structuredClone(response)
  const wrapped = KiloACP.wrap({ ...service, initialize: () => Effect.succeed(response) })
  const result = await Effect.runPromise(wrapped.initialize(input))
  expect(result).toEqual({
    ...snapshot,
    authMethods: [
      {
        ...snapshot.authMethods[0],
        _meta: {
          ...snapshot.authMethods[0]._meta,
          "terminal-auth": { command: "kilo2", args: ["x", "y"], label: "Label", extra: { x: 1 } },
        },
      },
      ...snapshot.authMethods.slice(1),
    ],
  })
  expect(response).toEqual(snapshot)
  const without = { protocolVersion: 1, agentCapabilities: {}, _meta: { untouched: true } } satisfies InitializeResponse
  expect(
    await Effect.runPromise(KiloACP.wrap({ ...service, initialize: () => Effect.succeed(without) }).initialize(input)),
  ).toEqual(without)
})

test("ACP agent mirror differs from upstream only at host integration points", async () => {
  const upstream = (await Bun.file(new URL("../../cli/src/acp/agent.ts", import.meta.url)).text()).replaceAll(
    "\r\n",
    "\n",
  )
  const mirror = (await Bun.file(new URL("../src/acp-agent.ts", import.meta.url)).text()).replaceAll("\r\n", "\n")
  const replace = (source: string, from: string, to: string) => {
    expect(source.split(from)).toHaveLength(2)
    return source.replace(from, to)
  }
  let normalized = upstream
  for (const comment of [
    "// Untraced so request spans parent to the caller's span instead of a setup span that has already ended.\n",
    "  // Requests can dispatch before the service below is built.\n",
  ]) {
    normalized = replace(normalized, comment, "")
  }
  for (const name of ["capabilities", "catalog", "client", "connection", "error", "service", "sessions", "turn"]) {
    normalized = replace(normalized, `from "./${name}"`, `from "@opencode/cli/acp/${name}"`)
  }
  normalized = replace(
    normalized,
    'import { ACPTurn } from "@opencode/cli/acp/turn"',
    'import { ACPTurn } from "@opencode/cli/acp/turn"\nimport { KiloACP } from "./acp-service"\nimport { KiloBinary } from "./binary"',
  )
  normalized = replace(normalized, 'agent({ name: "opencode" })', "agent({ name: KiloBinary })")
  normalized = replace(
    normalized,
    "service: ACPService.make({ client, connection, catalog, sessions, capabilities, turn }),",
    "service: KiloACP.wrap(ACPService.make({ client, connection, catalog, sessions, capabilities, turn })),",
  )
  normalized = replace(normalized, 'export * as ACP from "./agent"', 'export * as ACP from "./acp-agent"')
  expect(mirror).toBe(normalized)
})
