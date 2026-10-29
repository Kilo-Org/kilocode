export * as KiloGuardrails from "./guardrails.js"

import { Effect, Option, Schema } from "effect"
import { KiloHeaders } from "./headers.js"
import { json, request } from "./http.js"
import type { KiloMcpIdentity } from "./mcp-identity.js"
import { KiloServer } from "./server.js"

// The cloud accepts at most this many connections in one report.
export const MAX_REPORT_CONNECTIONS = 50
const CLIENTS = ["cli", "cloud_agent", "vscode", "jetbrains", "other"] as const

const AllowedServer = Schema.Struct({
  identityKey: Schema.String,
  name: Schema.String,
  config: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("remote"), url: Schema.String }),
    Schema.Struct({
      kind: Schema.Literal("package"),
      ecosystem: Schema.Literals(["npm", "pypi"]),
      identifier: Schema.String,
      min_version: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ]),
})

// Organizations without AI Guardrails get `off` and no servers, so a client never handles a "not available" error.
const Policy = Schema.Struct({
  mcp: Schema.Struct({
    enforcement: Schema.Literals(["off", "shadow", "enforce"]),
    allowedServers: Schema.Array(AllowedServer),
  }),
})
export type Policy = typeof Policy.Type
export type Enforcement = Policy["mcp"]["enforcement"]

const Report = Schema.Struct({
  enforcement: Schema.Literals(["off", "shadow", "enforce"]),
  results: Schema.Array(
    Schema.Struct({
      decision: Schema.Literals(["allowed", "denied"]),
      identityKey: Schema.NullOr(Schema.String),
      action: Schema.Literals(["allow", "block"]),
      recorded: Schema.Boolean,
    }),
  ),
})
export type Report = typeof Report.Type

export type Client = (typeof CLIENTS)[number]

export interface Connection {
  readonly target: KiloMcpIdentity.Target
  readonly serverName?: string
  readonly version?: string | null
}

const decodePolicy = Schema.decodeUnknownOption(Policy)
const decodeReport = Schema.decodeUnknownOption(Report)

/** The client product reported with each connection. */
export function client(env: Record<string, string | undefined> = process.env): Client {
  return CLIENTS.find((item) => item === env.KILO_PLATFORM) ?? "cli"
}

/**
 * The organization's MCP guardrails. Undefined when the cloud says the user has no such organization (404), so
 * the caller drops the policy; every other failure is an error so the caller keeps what it had.
 */
export function policy(
  server: string,
  token: string,
  organizationID: string,
  version = "unknown",
): Effect.Effect<Policy | undefined, Error> {
  return Effect.gen(function* () {
    const response = yield* request(
      KiloServer.apiUrl(server, "organizations", organizationID, "guardrails"),
      { headers: headers(token, organizationID, version) },
      "Guardrails fetch failed",
    )
    if (response.status === 404) return undefined
    if (!response.ok) return yield* Effect.fail(new Error(`Guardrails fetch failed with status ${response.status}`))
    const parsed = decodePolicy(yield* json(response, "Guardrails fetch failed"))
    if (Option.isNone(parsed)) return yield* Effect.fail(new Error("Invalid guardrails response"))
    return parsed.value
  })
}

/** Reports the MCP servers a client connects to; the cloud writes them to the organization's audit log. */
export function report(
  server: string,
  token: string,
  organizationID: string,
  input: { readonly client: Client; readonly connections: readonly Connection[] },
  version = "unknown",
): Effect.Effect<readonly Report[], Error> {
  return Effect.forEach(chunks(input.connections), (connections) =>
    Effect.gen(function* () {
      const response = yield* request(
        KiloServer.apiUrl(server, "organizations", organizationID, "guardrails", "mcp-connections"),
        {
          method: "POST",
          headers: { ...headers(token, organizationID, version), "Content-Type": "application/json" },
          body: JSON.stringify({ client: input.client, connections }),
        },
        "Guardrails report failed",
      )
      if (!response.ok) return yield* Effect.fail(new Error(`Guardrails report failed with status ${response.status}`))
      const parsed = decodeReport(yield* json(response, "Guardrails report failed"))
      if (Option.isNone(parsed)) return yield* Effect.fail(new Error("Invalid guardrails report response"))
      return parsed.value
    }),
  )
}

function headers(token: string, organizationID: string, version: string) {
  return { ...KiloHeaders.provider({ version, organizationID }), Authorization: `Bearer ${token}` }
}

function chunks<A>(items: readonly A[]) {
  return Array.from({ length: Math.ceil(items.length / MAX_REPORT_CONNECTIONS) }, (_, index) =>
    items.slice(index * MAX_REPORT_CONNECTIONS, (index + 1) * MAX_REPORT_CONNECTIONS),
  )
}
