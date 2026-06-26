import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import { InstanceRef } from "../../../src/effect/instance-ref"
import { Stack } from "../../../src/kilocode/stack/schema"
import { StackService } from "../../../src/kilocode/stack/service"
import { StackApi, StackApiMessages, StackPaths } from "../../../src/kilocode/server/httpapi/groups/stack"
import { stackHandlers } from "../../../src/kilocode/server/httpapi/handlers/stack"
import { InstanceStore } from "../../../src/project/instance-store"
import { ProjectID } from "../../../src/project/schema"
import { Session } from "../../../src/session/session"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { disposeMiddleware } from "../../../src/server/routes/instance/httpapi/lifecycle"
import { testEffect } from "../../lib/effect"

const revision = "2026-06-22.1"
const digest = `sha256:${"0".repeat(64)}`
const draft = Schema.decodeUnknownSync(Stack.Draft)({ verticals: {}, resources: {} })
const success = Schema.decodeUnknownSync(Stack.ApplyResponse)({
  results: [],
  state: {
    draft,
    resources: [],
    conflicts: [],
    config_revision: digest,
    catalog_revision: revision,
  },
})
const failed = Schema.decodeUnknownSync(Stack.Result)({
  resource: "skill:dbt",
  action: "install",
  success: false,
  message: "Resource action was not applied.",
})
const internal = "sensitive filesystem and credential details"
const disposed: string[] = []
const instance = {
  directory: "/tmp/stack-httpapi-test",
  worktree: "/tmp/stack-httpapi-test",
  project: {
    id: ProjectID.make("stack-httpapi-test"),
    worktree: "/tmp/stack-httpapi-test",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}

const stack = Layer.mock(StackService.Service)({
  catalog: () => Effect.fail(new StackService.MarketplaceUnavailableError({ message: internal })),
  get: () => Effect.fail(new StackService.InvalidConfigError({ message: internal })),
  preview: (input) =>
    Object.keys(input.resources).includes("skill:invalid-config")
      ? Effect.fail(new StackService.InvalidConfigError({ message: internal }))
      : Effect.fail(new StackService.InvalidDraftError({ message: internal })),
  apply: (_draft, hash) => {
    const code = hash.slice("sha256:".length, "sha256:".length + 1)
    if (code === "1") return Effect.fail(new StackService.InvalidConfigError({ message: internal }))
    if (code === "2") return Effect.fail(new StackService.InvalidDraftError({ message: internal }))
    if (code === "3") return Effect.fail(new StackService.StalePlanError({ message: internal }))
    if (code === "4")
      return Effect.fail(
        new StackService.MissingResourceError({
          message: internal,
          resources: [Stack.ResourceRef.make("skill:dbt")],
        }),
      )
    if (code === "5") return Effect.fail(new StackService.MarketplaceUnavailableError({ message: internal }))
    if (code === "6" || code === "7")
      return Effect.fail(
        new StackService.ApplyError({
          message: internal,
          rollback: code === "6",
          results: [failed],
        }),
      )
    return Effect.succeed(success)
  },
  detect: () => Effect.succeed(Schema.decodeUnknownSync(Stack.DetectionResponse)({ detections: [] })),
})
const store = Layer.mock(InstanceStore.Service)({
  dispose: (ctx) =>
    Effect.sync(() => {
      disposed.push(ctx.directory)
    }),
})
const session = Layer.mock(Session.Service)({})
const authorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const routing = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    effect.pipe(
      Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: instance.directory })),
    ),
  ),
)
const context = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => effect.pipe(Effect.provideService(InstanceRef, instance))),
)
const handlers = stackHandlers.pipe(Layer.provide(stack))
const TestApi = HttpApi.make("opencode-instance").addHttpApi(StackApi)
const routes = HttpApiBuilder.layer(TestApi).pipe(
  Layer.provide(handlers),
  Layer.provide(authorization),
  Layer.provide(routing),
  Layer.provide(context),
  Layer.provide(schemaErrorLayer),
  Layer.provide(session),
  HttpRouter.provideRequest(store),
)
const serve = () => HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(Layer.build)
const serveDispose = () =>
  HttpRouter.serve(routes, {
    middleware: disposeMiddleware,
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.build)
const it = testEffect(NodeHttpServer.layerTest)

function post(path: string, body: unknown) {
  return HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
}

function hash(code: string) {
  return `sha256:${code}${"0".repeat(63)}`
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function field(value: unknown, key: string) {
  if (!record(value) || !record(value.properties) || !(key in value.properties)) {
    throw new Error(`Missing OpenAPI property ${key}`)
  }
  return value.properties[key]
}

function variant(value: unknown, type: string) {
  if (!record(value) || !Array.isArray(value.anyOf)) throw new Error(`Missing OpenAPI ${type} variant`)
  const found = value.anyOf.find((item) => record(item) && item.type === type)
  if (!found) throw new Error(`Missing OpenAPI ${type} variant`)
  return found
}

describe("Stack HttpApi contract", () => {
  test("declares routed SDK operations and explicit statuses", () => {
    const spec = OpenApi.fromApi(StackApi)
    const routes = [
      { path: StackPaths.catalog, method: "get", operation: "stack.catalog", statuses: ["200", "401", "503"] },
      {
        path: StackPaths.get,
        method: "get",
        operation: "stack.get",
        statuses: ["200", "400", "401", "503"],
      },
      {
        path: StackPaths.detect,
        method: "get",
        operation: "stack.detect",
        statuses: ["200", "401"],
      },
      {
        path: StackPaths.preview,
        method: "post",
        operation: "stack.preview",
        statuses: ["200", "400", "401"],
      },
      {
        path: StackPaths.apply,
        method: "post",
        operation: "stack.apply",
        statuses: ["200", "400", "401", "409", "424", "500", "503"],
      },
    ] as const

    for (const route of routes) {
      const operation = spec.paths[route.path]?.[route.method]
      expect(operation?.operationId).toBe(route.operation)
      expect(operation?.parameters?.filter((param) => param.in === "query").map((param) => param.name)).toEqual([
        "directory",
        "workspace",
      ])
      expect(Object.keys(operation?.responses ?? {}).toSorted()).toEqual([...route.statuses].toSorted())
    }

    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
        "StackCatalogResponse",
        "StackStateResponse",
        "StackDetectionResponse",
        "StackPreviewInput",
        "StackPreviewResponse",
        "StackApplyInput",
        "StackApplyResponse",
        "StackInvalidConfigError",
        "StackInvalidDraftError",
        "StackStalePlanError",
        "StackMissingResourceError",
        "StackMarketplaceUnavailableError",
        "StackApplyError",
      ]),
    )
  })

  test("emits SDK-safe transport records", () => {
    const vertical = {
      type: "object",
      properties: {
        technologies: { type: "array", items: { type: "string" } },
      },
      required: ["technologies"],
      additionalProperties: false,
    }
    const override = {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        method: { type: "string" },
        parameters: {
          type: "object",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    }
    const receipt = {
      type: "object",
      properties: {
        marketplace_id: { type: "string" },
        version: { type: "string" },
        digest: { type: "string" },
        fingerprint: { type: "string" },
      },
      required: ["marketplace_id", "version", "digest", "fingerprint"],
      additionalProperties: false,
    }
    const spec = OpenApi.fromApi(StackApi)
    const preview = spec.components.schemas.StackPreviewInput
    const draft = field(preview, "draft")
    expect(field(draft, "verticals")).toEqual({ type: "object", additionalProperties: vertical })
    expect(field(draft, "resources")).toEqual({ type: "object", additionalProperties: override })

    const state = spec.components.schemas.StackStateResponse
    const config = variant(field(state, "config"), "object")
    expect(field(config, "catalog_revision")).toEqual({ type: "string" })
    expect(field(config, "verticals")).toEqual({ type: "object", additionalProperties: vertical })
    expect(field(config, "resources")).toEqual({ type: "object", additionalProperties: override })
    expect(field(config, "managed")).toEqual({ type: "object", additionalProperties: receipt })
  })
})

describe("Stack HttpApi handlers", () => {
  it.live("maps domain failures to safe API bodies", () =>
    Effect.gen(function* () {
      yield* serve()
      const catalog = yield* HttpClient.get(StackPaths.catalog)
      expect(catalog.status).toBe(503)
      expect(yield* catalog.json).toEqual({
        code: "marketplace_unavailable",
        message: StackApiMessages.unavailable,
      })

      const get = yield* HttpClient.get(StackPaths.get)
      expect(get.status).toBe(400)
      expect(yield* get.json).toEqual({ code: "invalid_config", message: StackApiMessages.invalidConfig })

      const invalidDraft = yield* post(StackPaths.preview, { draft })
      expect(invalidDraft.status).toBe(400)
      expect(yield* invalidDraft.json).toEqual({ code: "invalid_draft", message: StackApiMessages.invalidDraft })

      const invalidConfig = yield* post(StackPaths.preview, {
        draft: { verticals: {}, resources: { "skill:invalid-config": { enabled: true } } },
      })
      expect(invalidConfig.status).toBe(400)
      expect(yield* invalidConfig.json).toEqual({ code: "invalid_config", message: StackApiMessages.invalidConfig })

      const cases = [
        { code: "1", status: 400, body: { code: "invalid_config", message: StackApiMessages.invalidConfig } },
        { code: "2", status: 400, body: { code: "invalid_draft", message: StackApiMessages.invalidDraft } },
        { code: "3", status: 409, body: { code: "stale_plan", message: StackApiMessages.stale } },
        {
          code: "4",
          status: 424,
          body: {
            code: "missing_marketplace_resource",
            message: StackApiMessages.missing,
            resources: ["skill:dbt"],
          },
        },
        {
          code: "5",
          status: 503,
          body: { code: "marketplace_unavailable", message: StackApiMessages.unavailable },
        },
        {
          code: "6",
          status: 500,
          body: {
            code: "apply_failed",
            message: StackApiMessages.apply,
            rollback: true,
            results: [failed],
          },
        },
        {
          code: "7",
          status: 500,
          body: {
            code: "apply_failed",
            message: StackApiMessages.apply,
            rollback: false,
            results: [failed],
          },
        },
      ] as const

      for (const item of cases) {
        const response = yield* post(StackPaths.apply, { draft, plan_hash: hash(item.code) })
        expect(response.status).toBe(item.status)
        const body = yield* response.json
        expect(body).toEqual(item.body)
        expect(JSON.stringify(body)).not.toContain(internal)
      }
    }),
  )

  it.live("marks the instance for disposal after success or an incomplete rollback", () =>
    Effect.gen(function* () {
      yield* serveDispose()
      disposed.length = 0

      const stale = yield* post(StackPaths.apply, { draft, plan_hash: hash("3") })
      expect(stale.status).toBe(409)
      expect(disposed).toEqual([])

      const rolledBack = yield* post(StackPaths.apply, { draft, plan_hash: hash("6") })
      expect(rolledBack.status).toBe(500)
      expect(disposed).toEqual([])

      const incomplete = yield* post(StackPaths.apply, { draft, plan_hash: hash("7") })
      expect(incomplete.status).toBe(500)
      expect(disposed).toEqual([instance.directory])

      const response = yield* post(StackPaths.apply, { draft, plan_hash: hash("0") })
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual(success)
      expect(disposed).toEqual([instance.directory, instance.directory])
    }),
  )
})
