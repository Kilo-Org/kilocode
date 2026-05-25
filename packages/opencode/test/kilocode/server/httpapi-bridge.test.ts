import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { BackgroundProcessPaths } from "../../../src/kilocode/server/httpapi/groups/background-process"
import { KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { ExperimentalPaths } from "../../../src/server/routes/instance/httpapi/groups/experimental"
import { PublicApi } from "../../../src/server/routes/instance/httpapi/public"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
import { Server } from "../../../src/server/server"

const methods = ["get", "post", "put", "delete", "patch"] as const
let effectSpec: ReturnType<typeof OpenApi.fromApi> | undefined

function effectOpenApi() {
  return (effectSpec ??= OpenApi.fromApi(PublicApi))
}

function openApiRouteKeys(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], unknown>>> }) {
  return Object.entries(spec.paths)
    .flatMap(([path, item]) =>
      methods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function stableSchema(input: unknown): string {
  return JSON.stringify(sortSchema(input))
}

function sortSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortSchema)
  if (!input || typeof input !== "object") return input
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortSchema(value)]),
  )
}

type Operation = {
  responses?: unknown
}

function providerSchema(input: unknown) {
  if (!input || typeof input !== "object" || !("components" in input)) return undefined
  const components = input.components
  if (!components || typeof components !== "object" || !("schemas" in components)) return undefined
  const schemas = components.schemas
  if (!schemas || typeof schemas !== "object" || !("Config" in schemas)) return undefined
  const config = schemas.Config
  if (!config || typeof config !== "object" || !("properties" in config)) return undefined
  const props = config.properties
  if (!props || typeof props !== "object" || !("provider" in props)) return undefined
  const provider = props.provider
  if (!provider || typeof provider !== "object" || !("additionalProperties" in provider)) return undefined
  return provider.additionalProperties
}

function responseSchema(input: {
  spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }
  path: string
  method: (typeof methods)[number]
  status: string
  contentType: string
}) {
  const responses = input.spec.paths[input.path]?.[input.method]?.responses
  if (!responses || typeof responses !== "object" || !(input.status in responses)) return undefined
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Guarded dynamic OpenAPI response lookup.
  const response = (responses as Record<string, unknown>)[input.status]
  if (!response || typeof response !== "object" || !("content" in response)) return undefined
  const content = (response as { content?: unknown }).content
  if (!content || typeof content !== "object" || !(input.contentType in content)) return undefined
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Guarded dynamic OpenAPI response content lookup.
  const body = (content as Record<string, unknown>)[input.contentType]
  if (!body || typeof body !== "object" || !("schema" in body)) return undefined
  return body.schema
}

describe("Kilo HttpApi bridge", () => {
  test("mirrors Kilo overlay routes in Hono and Effect specs", async () => {
    const hono = new Set(openApiRouteKeys(await Server.openapiHono()))
    const effect = new Set(openApiRouteKeys(effectOpenApi()))
    const kilo = [
      `GET ${BackgroundProcessPaths.list}`,
      "GET /background-process/{processID}",
      "GET /background-process/{processID}/logs",
      "POST /background-process/{processID}/stop",
      "POST /background-process/{processID}/restart",
      "POST /background-process/session/{sessionID}/stop",
      "POST /permission/allow-everything",
      "POST /enhance-prompt",
      "POST /commit-message",
      `GET ${ExperimentalPaths.worktreeDiff}`,
      `GET ${ExperimentalPaths.worktreeDiffFile}`,
      `GET ${ExperimentalPaths.worktreeDiffSummary}`,
      "GET /network",
      "POST /network/{requestID}/reply",
      "POST /network/{requestID}/reject",
      `GET ${KiloGatewayPaths.modes}`,
      `POST ${KiloGatewayPaths.fim}`,
      `POST ${KiloGatewayPaths.audioTranscriptions}`,
      "POST /remote/enable",
      "POST /remote/disable",
      "GET /remote/status",
      `POST ${SessionPaths.viewed}`,
      "POST /telemetry/capture",
      "POST /telemetry/setEnabled",
      "GET /suggestion",
      "POST /suggestion/{requestID}/accept",
      "POST /suggestion/{requestID}/dismiss",
      "POST /kilocode/heap/snapshot",
      "POST /kilocode/skill/remove",
      "POST /kilocode/agent/remove",
      "POST /kilocode/session-import/project",
      "POST /kilocode/session-import/session",
      "POST /kilocode/session-import/message",
      "POST /kilocode/session-import/part",
    ]

    expect(kilo.filter((route) => !hono.has(route))).toEqual([])
    expect(kilo.filter((route) => !effect.has(route))).toEqual([])
    expect(hono.has("POST /background-process")).toBe(false)
    expect(effect.has("POST /background-process")).toBe(false)
    expect(effect.has("GET /indexing/status")).toBe(true)
  })

  test("documents cloud session import separately from id lookup", () => {
    const effect = effectOpenApi()

    expect(effect.paths["/kilo/cloud/session/import"]?.post).toBeDefined()
    expect(effect.paths["/kilo/cloud/session/{id}"]?.get).toBeDefined()
    expect(KiloGatewayPaths.cloudSessionImport).not.toBe(KiloGatewayPaths.cloudSession)
  })

  test("matches nullable provider delete sentinels", async () => {
    const hono = await Server.openapiHono()
    const effect = effectOpenApi()

    expect(stableSchema(providerSchema(effect))).toBe(stableSchema(providerSchema(hono)))
  })

  test("matches Kilo FIM SSE response schema", async () => {
    const hono = await Server.openapiHono()
    const effect = effectOpenApi()
    const input = {
      path: KiloGatewayPaths.fim,
      method: "post" as const,
      status: "200",
      contentType: "text/event-stream",
    }

    expect(stableSchema(responseSchema({ spec: effect, ...input }))).toBe(
      stableSchema(responseSchema({ spec: hono, ...input })),
    )
  })
})
