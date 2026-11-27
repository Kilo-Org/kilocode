import { describe, expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Agent } from "@opencode/core/agent"
import { AISDK } from "@opencode/core/aisdk"
import { App } from "@opencode/core/app"
import { Artifact } from "@opencode/core/artifact"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileSystem } from "@opencode/core/filesystem"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Flag } from "@opencode/core/flag"
import { Form } from "@opencode/core/form"
import { Generate } from "@opencode/core/generate"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Integration } from "@opencode/core/integration"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Reference } from "@opencode/core/reference"
import { Rpc } from "@opencode/core/rpc"
import { Session } from "@opencode/core/session"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { SharedCache } from "@opencode/core/shared-cache"
import { Skill } from "@opencode/core/skill"
import { SkillDiscovery } from "@opencode/core/skill/discovery"
import { Tool } from "@opencode/core/tool"
import { Vcs } from "@opencode/core/vcs"
import { WebSearch } from "@opencode/core/websearch"
import { Worktree } from "@opencode/core/worktree"
import { WorktreeStrategies } from "@opencode/core/worktree/strategies"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { AppProcess } from "@opencode/util/process"
import { Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Queue, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { withEnv } from "../../core/test/fixture/env"
import { tempLocationLayer } from "../../core/test/fixture/location"
import { emptyMcpLayer } from "../../core/test/fixture/mcp"
import { offlineModels } from "../../core/test/fixture/models"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { AUTH_VERIFY_COOLDOWN, KiloGatewayPlugin } from "../src/gateway"
import { GatewayCoalesce } from "../src/gateway/coalesce"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const integrationID = Integration.ID.make("kilo")
const methodID = Integration.MethodID.make("device")

const env = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_API_URL: undefined,
  KILO_AI_GATEWAY_URL: undefined,
  KILO_ORG_ID: undefined,
  KILO_MACHINE_ID: undefined,
  KILO_DATA_COLLECTION: undefined,
}

const oauth = (access: string, metadata: Record<string, unknown>) =>
  Credential.OAuth.make({ type: "oauth", methodID, access, refresh: access, expires: 0, metadata })

function eventually<A, E>(effect: Effect.Effect<A, E>, predicate: (value: A) => boolean, remaining = 1000) {
  return Effect.gen(function* (): Effect.fn.Return<A, E | Error> {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

const addPlugin = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = integrationID
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
    })
    editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* KiloPlugin.effect(host)
  yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
  return host
})

const trigger401 = (url: string, sessionID: string, authorization?: string) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    return yield* hooks.trigger("session", "http.response", {
      sessionID: sessionID as never,
      agent: Agent.ID.make("code"),
      model: { providerID: kilo, id: Model.ID.make("kilo-auto/frontier") },
      kind: "primary",
      request: new Request(`${url}/api/gateway/v1/chat/completions`, {
        method: "POST",
        headers: authorization ? { authorization } : {},
        body: "{}",
      }),
      response: Response.json(
        { error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." } },
        { status: 401 },
      ),
    })
  })

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
    video: {
      start: () => Effect.die("unused"),
      status: () => Effect.die("unused"),
      result: () => Effect.die("unused"),
    },
  }),
)

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    nested: () => Effect.void,
  }),
)

// Builds an independent Location environment sharing the outer test's global Bus, Credential, and Database services.
const bootLocation = Effect.fn(function* () {
  const bus = yield* Bus.Service
  const credentials = yield* Credential.Service
  const database = yield* Database.Service
  const global = yield* Global.Service
  const parent = yield* Scope.Scope
  const scope = yield* Scope.fork(parent)
  const configLayer = Config.testLayer()
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      App.node,
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Flag.node,
      Database.node,
      Environment.node,
      FileAccess.node,
      Global.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      Artifact.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      InstructionDiscovery.node,
      Integration.node,
      Job.node,
      KV.node,
      Mcp.node,
      Session.node,
      SharedCache.node,
      InstructionEntry.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Bus.node.replace(Layer.succeed(Bus.Service, bus)),
      Credential.node.replace(Layer.succeed(Credential.Service, credentials)),
      Database.node.replace(Layer.succeed(Database.Service, database)),
      Global.node.replace(Layer.succeed(Global.Service, global)),
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generateLayer),
      Permission.node.replace(permissionLayer),
      offlineModels,
    ],
  ).pipe(Layer.provideMerge(configLayer))

  const services = yield* Layer.build(layer).pipe(Scope.provide(scope))
  const host = yield* addPlugin().pipe(Effect.provide(services), Scope.provide(scope))
  return {
    scope,
    host,
    rpc: Context.get(services, Rpc.Service).client(KiloGatewayRpc.Definition),
    models: Context.get(services, Model.Service),
    providers: Context.get(services, Provider.Service),
    integrations: Context.get(services, Integration.Service),
    hooks: Context.get(services, PluginHooks.Service),
  }
})

describe("KiloGatewayPlugin auth recovery and coalescing", () => {
  it.live("invalidates Personal auth, surfaces needs_auth and catalog status on LLM 401 without looping", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "personal",
              value: oauth("valid-token", { server: backend.url, organizationID: null }),
            })
            const host = yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const integrations = yield* Integration.Service
            const models = yield* Model.Service
            const providers = yield* Provider.Service
            const bus = yield* Bus.Service

            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true, organizationID: null })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: null })
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()

            const catalogEvents = yield* Queue.unbounded<KiloGatewayRpc.CatalogStatus>()
            yield* rpc.events.subscribe("catalog").pipe(
              Stream.runForEach((event) => Queue.offer(catalogEvents, event.data)),
              Effect.forkScoped({ startImmediately: true }),
            )
            const integrationEvents = yield* Queue.unbounded<void>()
            yield* bus.subscribe(Integration.Event.Updated).pipe(
              Stream.runForEach(() => Queue.offer(integrationEvents, undefined)),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* Effect.yieldNow

            // Revoke the token server-side; the plugin only learns when an LLM response returns 401.
            backend.state.profileStatus = 401
            backend.state.authenticatedModelsStatus = 401
            backend.requests.length = 0

            const session = yield* host.session.create({ title: "401 recovery" })
            const rewritten = yield* trigger401(backend.url, session.id, "Bearer valid-token")
            expect(rewritten.response.status).toBe(401)
            expect(rewritten.response.headers.get("x-should-retry")).toBe("false")
            expect(yield* Effect.promise(() => rewritten.response.json())).toMatchObject({
              error: { code: "INVALID_TOKEN", retryable: false },
            })

            expect(yield* Queue.take(catalogEvents)).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            // Keep authStatus.authenticated + method intact (#16600) so ProfileView / TUI distinguish expired OAuth from signed-out.
            expect(yield* rpc.authStatus({})).toMatchObject({
              authenticated: true,
              method: "oauth",
              organizationID: null,
              server: backend.url,
            })
            expect(yield* rpc.profile({}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })
            yield* Queue.take(integrationEvents)
            expect((yield* integrations.get(integrationID))?.connections).toMatchObject([
              {
                type: "credential",
                label: "personal",
                status: { status: "needs_auth", message: "Credentials rejected (HTTP 401) - sign in again" },
              },
            ])
            expect((yield* providers.get(kilo))?.settings?.apiKey).toBe("anonymous")
            expect(
              (yield* models.available()).filter((item) => item.providerID === kilo).map((item) => item.id),
            ).toEqual([Model.ID.make("kilo-auto/free"), Model.ID.make("kilo-auto/small")])

            // Subsequent 401s must not re-trigger verification once auth is already invalidated.
            const count = backend.requests.length
            yield* trigger401(backend.url, session.id, "Bearer valid-token")
            yield* trigger401(backend.url, session.id, "Bearer anonymous")
            yield* Effect.promise(() => Bun.sleep(20))
            expect(backend.requests).toHaveLength(count)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("fails closed and marks connection needs_auth on Team LLM 401", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "team",
              value: oauth("team-token", { server: backend.url, organizationID: "selected" }),
            })
            const host = yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const integrations = yield* Integration.Service
            const models = yield* Model.Service
            const providers = yield* Provider.Service

            expect(yield* rpc.authStatus({})).toEqual({
              authenticated: true,
              method: "oauth",
              organizationID: "selected",
              server: backend.url,
            })

            backend.state.profileStatus = 401
            backend.state.teamModelsStatus = 401
            const session = yield* host.session.create({ title: "team 401" })
            yield* trigger401(backend.url, session.id, "Bearer team-token")

            expect(
              yield* eventually(rpc["catalog.status"]({}), (value) => value.failure?.kind === "unauthorized"),
            ).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            expect(yield* rpc.authStatus({})).toEqual({
              authenticated: true,
              method: "oauth",
              organizationID: "selected",
              server: backend.url,
            })
            expect((yield* models.available()).filter((item) => item.providerID === kilo)).toEqual([])
            expect((yield* providers.available()).some((provider) => provider.id === kilo)).toBe(false)
            expect((yield* integrations.get(integrationID))?.connections).toMatchObject([
              {
                type: "credential",
                label: "team",
                status: { status: "needs_auth", message: "Credentials rejected (HTTP 401) - sign in again" },
              },
            ])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.effect("debounces repeated LLM 401 verification while the token stays valid and re-verifies after cooldown", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "byok",
              value: oauth("valid-token", { server: backend.url, organizationID: null }),
            })
            const host = yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const integrations = yield* Integration.Service
            const session = yield* host.session.create({ title: "byok 401" })

            backend.requests.length = 0
            // Burst of 401s while the Kilo token itself is still valid (e.g. upstream BYOK 401).
            yield* Effect.all(
              [
                trigger401(backend.url, session.id, "Bearer valid-token"),
                trigger401(backend.url, session.id, "Bearer valid-token"),
                trigger401(backend.url, session.id, "Bearer valid-token"),
              ],
              { concurrency: 3 },
            )
            yield* eventually(
              Effect.sync(() => backend.requests.some((request) => request.path.endsWith("/models"))),
              Boolean,
            )
            // Let the single verification settle and verify only one verification round ran.
            yield* Effect.promise(() => Bun.sleep(10))
            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(1)
            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: null })
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()

            // Still inside the cooldown window: another 401 must not trigger another verification.
            yield* TestClock.adjust(Duration.toMillis(AUTH_VERIFY_COOLDOWN) - 1_000)
            yield* trigger401(backend.url, session.id, "Bearer valid-token")
            yield* Effect.promise(() => Bun.sleep(10))
            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(1)

            // Once the cooldown elapses and the token is actually revoked, verification runs again.
            backend.state.profileStatus = 401
            backend.state.authenticatedModelsStatus = 401
            yield* TestClock.adjust("1 second")
            yield* trigger401(backend.url, session.id, "Bearer valid-token")
            expect(
              yield* eventually(rpc["catalog.status"]({}), (value) => value.failure?.kind === "unauthorized"),
            ).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(2)
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toEqual({
              status: "needs_auth",
              message: "Credentials rejected (HTTP 401) - sign in again",
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("clears prior connection needs_auth on re-login and ignores stale-token or anonymous 401s", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const backend = fixture()
        const proxy = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            if (request.headers.get("authorization") === "Bearer expired-token") {
              return new Response("Unauthorized", { status: 401 })
            }
            return fetch(new Request(new URL(new URL(request.url).pathname, backend.url), request))
          },
        })
        return {
          backend,
          url: proxy.url.origin,
          [Symbol.dispose]() {
            proxy.stop(true)
            backend[Symbol.dispose]()
          },
        }
      }),
      ({ backend, url }) =>
        withEnv({ ...env, KILO_API_URL: url }, () =>
          Effect.gen(function* () {
            // Anonymous 401 never triggers verification.
            const host = yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const integrations = yield* Integration.Service
            const credentials = yield* Credential.Service
            const session = yield* host.session.create({ title: "relogin race" })

            backend.requests.length = 0
            yield* trigger401(url, session.id, "Bearer anonymous")
            yield* Effect.promise(() => Bun.sleep(20))
            expect(backend.requests).toEqual([])

            // Active expired credential triggers needs_auth and unauthorized catalog status while keeping OAuth authStatus (#16600).
            yield* credentials.create({
              integrationID,
              label: "old-account",
              value: oauth("expired-token", { server: url, organizationID: null }),
            })
            yield* eventually(
              integrations.get(integrationID),
              (info) => info?.connections.some((connection) => connection.status?.status === "needs_auth") === true,
            )
            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true, method: "oauth" })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "unauthorized", status: 401 } })

            // Re-login adds a fresh active credential while leaving the old one in integration.connections.
            yield* credentials.create({
              integrationID,
              label: "new-account",
              value: oauth("fresh-token", { server: url, organizationID: null }),
            })
            yield* eventually(
              Effect.all([rpc["catalog.status"]({}), rpc.authStatus({})]),
              ([status, auth]) => status.failure === null && auth.authenticated,
            )
            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true, method: "oauth" })

            // Both connections are present and neither carries a stale needs_auth status.
            const connections = (yield* integrations.get(integrationID))?.connections ?? []
            expect(connections).toHaveLength(2)
            expect(connections.find((connection) => connection.status)).toBeUndefined()

            // A late 401 from an in-flight request that sent the old token must not invalidate the new session.
            backend.requests.length = 0
            yield* trigger401(url, session.id, "Bearer expired-token")
            yield* Effect.promise(() => Bun.sleep(20))
            expect(backend.requests).toEqual([])
            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true })
            expect((yield* integrations.get(integrationID))?.connections.find((connection) => connection.status)).toBeUndefined()
          }),
        ),
      (server) => Effect.sync(() => server[Symbol.dispose]()),
    ),
  )

  it.live("distinguishes 503 outages from 401/403 rejections and skips snapshot reuse on 401", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const integrations = yield* Integration.Service
            const models = yield* Model.Service
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const bus = yield* Bus.Service

            // Personal profile 503 outage: fail closed, but keep authenticated: true and do not flag needs_auth.
            yield* credentials.create({
              integrationID,
              label: "personal",
              value: oauth("personal-token", { server: backend.url, organizationID: null }),
            })
            backend.state.profileStatus = 503
            yield* addPlugin()
            expect(yield* rpc.authStatus({})).toMatchObject({ authenticated: true, method: "oauth", organizationID: null })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "http", status: 503 } })
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()

            // Recover to save a warm Personal snapshot, then revoke both profile and all models with 401.
            backend.state.profileStatus = 200
            yield* bus.publish(Bus.ephemeral({ type: "config.updated", schema: {} }), {})
            yield* eventually(rpc["catalog.status"]({}), (status) => status.failure === null)
            expect((yield* models.available()).filter((item) => item.providerID === kilo)).toHaveLength(3)

            // Double 401 (auth + public) must NOT resurrect the warm Personal snapshot.
            backend.state.profileStatus = 401
            backend.state.modelsStatus = 401
            yield* bus.publish(Bus.ephemeral({ type: "config.updated", schema: {} }), {})
            yield* eventually(rpc["catalog.status"]({}), (status) => status.failure?.kind === "unauthorized")
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            expect((yield* models.available()).filter((item) => item.providerID === kilo)).toEqual([])
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toEqual({
              status: "needs_auth",
              message: "Credentials rejected (HTTP 401) - sign in again",
            })

            // Team 503 outage does not flag needs_auth; Team 403 reports unauthorized + needs_auth.
            backend.state.profileStatus = 200
            backend.state.modelsStatus = 200
            backend.state.teamModelsStatus = 503
            yield* credentials.create({
              integrationID,
              label: "team",
              value: oauth("team-token", { server: backend.url, organizationID: "selected" }),
            })
            yield* eventually(rpc["catalog.status"]({}), (status) => status.failure?.status === 503)
            expect(yield* rpc.authStatus({})).toEqual({
              authenticated: true,
              method: "oauth",
              organizationID: "selected",
              server: backend.url,
            })
            expect((yield* integrations.get(integrationID))?.connections.find((item) => item.status)).toBeUndefined()

            backend.state.teamModelsStatus = 403
            yield* bus.publish(Bus.ephemeral({ type: "config.updated", schema: {} }), {})
            yield* eventually(rpc["catalog.status"]({}), (status) => status.failure?.kind === "unauthorized")
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "unauthorized", status: 403 } })
            expect((yield* integrations.get(integrationID))?.connections[0]?.status).toEqual({
              status: "needs_auth",
              message: "Credentials rejected (HTTP 403) - sign in again",
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("maps 401 and 403 ProfileError to unauthorized on profile and organization.set RPCs and 503 to failed", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "profile-token" }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)

            for (const status of [401, 403]) {
              backend.state.profileStatus = status
              expect(yield* rpc.profile({}).pipe(Effect.flip)).toMatchObject({
                type: "unauthorized",
                message: "Invalid token",
              })
              expect(yield* rpc["organization.set"]({ organizationID: "first" }).pipe(Effect.flip)).toMatchObject({
                type: "unauthorized",
                message: "Invalid token",
              })
            }

            backend.state.profileStatus = 503
            expect(yield* rpc.profile({}).pipe(Effect.flip)).toMatchObject({
              type: "failed",
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("coalesces multi-Location credential.switched fetches and propagates 401 across Locations", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            // Start from a Team scope (never cached to KV) so all 3 Locations settle synchronously before switching.
            yield* credentials.create({
              integrationID,
              label: "initial-team",
              value: oauth("initial-token", { server: backend.url, organizationID: "first" }),
            })
            const locations = [yield* bootLocation(), yield* bootLocation(), yield* bootLocation()]

            backend.requests.length = 0
            // Realistic network latency so all 3 Locations overlap on each upstream stage.
            backend.state.delay = 50

            yield* credentials.create({
              integrationID,
              label: "shared-team",
              value: oauth("shared-token", { server: backend.url, organizationID: "selected" }),
            })

            for (const loc of locations) {
              yield* eventually(loc.rpc.authStatus({}), (status) => status.authenticated && status.organizationID === "selected")
              expect(
                (yield* loc.models.available()).filter((item) => item.providerID === kilo).map((item) => item.id),
              ).toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
            }

            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(1)
            expect(backend.requests.filter((request) => request.path === "/api/organizations/selected/modes")).toHaveLength(1)
            expect(
              backend.requests.filter((request) => request.path === "/api/gateway/v1/organizations/selected/models"),
            ).toHaveLength(1)
            expect(
              backend.requests.filter((request) => request.path === "/api/organizations/selected/defaults"),
            ).toHaveLength(1)

            // Transient 503 failure on credential switch also coalesces so Locations do not fan out or diverge.
            backend.state.teamModelsStatus = 503
            backend.requests.length = 0
            yield* credentials.create({
              integrationID,
              label: "outage-team",
              value: oauth("outage-token", { server: backend.url, organizationID: "first" }),
            })
            for (const loc of locations) {
              expect(
                yield* eventually(loc.rpc["catalog.status"]({}), (status) => status.failure?.status === 503),
              ).toEqual({ failure: { kind: "http", status: 503 } })
              expect(yield* loc.rpc.authStatus({})).toMatchObject({ authenticated: true, organizationID: "first" })
            }
            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(1)
            expect(
              backend.requests.filter((request) => request.path === "/api/gateway/v1/organizations/first/models"),
            ).toHaveLength(1)

            // Recover to a valid team credential, then revoke and trigger 401 ONLY in Location 2 (a worktree).
            backend.state.teamModelsStatus = 200
            yield* credentials.create({
              integrationID,
              label: "active-team",
              value: oauth("active-token", { server: backend.url, organizationID: "selected" }),
            })
            for (const loc of locations) {
              yield* eventually(
                loc.rpc["catalog.status"]({}),
                (status) => status.failure === null,
              )
              yield* eventually(loc.rpc.authStatus({}), (status) => status.authenticated && status.organizationID === "selected")
            }

            // Location 1 (main workspace) and Location 3 (other worktree) must also become unauthorized.
            backend.state.profileStatus = 401
            backend.state.teamModelsStatus = 401
            backend.requests.length = 0

            const session = yield* locations[1]!.host.session.create({ title: "worktree 401" })
            yield* locations[1]!.hooks.trigger("session", "http.response", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("anthropic/claude-sonnet-4.6") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`, {
                method: "POST",
                headers: { authorization: "Bearer active-token" },
                body: "{}",
              }),
              response: Response.json(
        { error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." } },
        { status: 401 },
      ),
            })

            for (const loc of locations) {
              expect(
                yield* eventually(loc.rpc["catalog.status"]({}), (status) => status.failure?.kind === "unauthorized"),
              ).toEqual({ failure: { kind: "unauthorized", status: 401 } })
              expect(yield* loc.rpc.authStatus({})).toEqual({
                authenticated: true,
                method: "oauth",
                organizationID: "selected",
                server: backend.url,
              })
              expect((yield* loc.integrations.get(integrationID))?.connections[0]?.status).toEqual({
                status: "needs_auth",
                message: "Credentials rejected (HTTP 401) - sign in again",
              })
            }
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("disposing one Location during a coalesced fetch does not break other joiners", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "initial-team",
              value: oauth("initial-token", { server: backend.url, organizationID: "first" }),
            })
            const first = yield* bootLocation()
            const second = yield* bootLocation()

            backend.requests.length = 0
            const profileGate = Promise.withResolvers<void>()
            backend.state.profilePending = profileGate.promise

            yield* credentials.create({
              integrationID,
              label: "dispose-race",
              value: oauth("dispose-token", { server: backend.url, organizationID: null }),
            })

            // Wait until both Locations invalidated their prior scope and the shared profile request is in flight.
            yield* eventually(
              Effect.all([first.models.available(), second.models.available()]),
              ([a, b]) =>
                !a.some((model) => model.providerID === kilo) &&
                !b.some((model) => model.providerID === kilo) &&
                backend.requests.some((request) => request.path === "/api/profile"),
            )
            yield* Effect.promise(() => Bun.sleep(15))

            // Dispose the first Location while the shared profile request is still in flight.
            yield* Scope.close(first.scope, Exit.void)
            profileGate.resolve()

            // The second Location still completes cleanly using the shared flight.
            expect(yield* eventually(second.rpc.authStatus({}), (status) => status.authenticated && status.organizationID === null)).toMatchObject({
              authenticated: true,
              organizationID: null,
            })
            expect(
              (yield* second.models.available()).filter((item) => item.providerID === kilo).map((item) => item.id),
            ).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
              Model.ID.make("kilo-auto/small"),
            ])
            expect(backend.requests.filter((request) => request.path === "/api/profile")).toHaveLength(1)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("does not blame a stored credential when an overriding KILO_API_KEY env token fails with 401", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "bad-env-token", KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "saved-oauth",
              value: oauth("good-saved-token", { server: backend.url, organizationID: "selected" }),
            })
            backend.state.profileStatus = 401
            backend.state.teamModelsStatus = 401
            yield* addPlugin()
            const rpc = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const integrations = yield* Integration.Service
            expect(yield* rpc.authStatus({})).toEqual({
              authenticated: true,
              organizationID: "selected",
              server: backend.url,
            })
            expect(yield* rpc["catalog.status"]({})).toEqual({ failure: { kind: "unauthorized", status: 401 } })
            // The saved credential was shadowed by KILO_API_KEY and must not be marked needs_auth.
            expect((yield* integrations.get(integrationID))?.connections.find((item) => item.status)).toBeUndefined()
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("coalescer isolates caller interruption from joiners, cancels orphaned work, and never shares across tokens, orgs, or servers", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({ a: fixture(), b: fixture() })),
      (backends) =>
        Effect.gen(function* () {
          // 1. Interrupting the first caller leaves the shared flight running for remaining joiners.
          const release = yield* Deferred.make<string>()
          let invocations = 0
          const load = () =>
            Effect.sync(() => {
              invocations++
            }).pipe(Effect.andThen(Deferred.await(release)))
          const caller1 = yield* GatewayCoalesce.run("test:joiner", load).pipe(
            Effect.forkChild({ startImmediately: true }),
          )
          const caller2 = yield* GatewayCoalesce.run("test:joiner", load).pipe(
            Effect.forkChild({ startImmediately: true }),
          )
          expect(invocations).toBe(1)
          yield* Fiber.interrupt(caller1)
          yield* Deferred.succeed(release, "shared-ok")
          expect(yield* Fiber.join(caller2)).toBe("shared-ok")

          // 2. Orphaned flight cancels cleanly when the last waiter is interrupted.
          const started = yield* Deferred.make<void>()
          const interrupted = yield* Deferred.make<void>()
          const orphan = yield* GatewayCoalesce.run("test:orphan", () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
          ).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(started)
          yield* Fiber.interrupt(orphan)
          yield* Deferred.await(interrupted)

          // A fresh run with the same key succeeds cleanly after the orphaned run was cleaned up.
          expect(yield* GatewayCoalesce.run("test:orphan", () => Effect.succeed("fresh"))).toBe("fresh")

          // 2. Concurrent fetches with different tokens, orgs, or servers never share results.
          backends.a.state.delay = 30
          backends.b.state.delay = 30
          backends.b.state.models = {
            data: [{ id: "server-b/model", name: "Server B", context_length: 128000, isFree: true }],
          }
          const [personalA, personalOtherToken, teamA, anonymousA, emptyTokenA, serverB] = yield* Effect.all(
            [
              GatewayCoalesce.catalog({
                api: backends.a.url,
                base: backends.a.url,
                token: "tok-1",
                organizationID: null,
                version: "1.0.0",
              }),
              GatewayCoalesce.catalog({
                api: backends.a.url,
                base: backends.a.url,
                token: "tok-2",
                organizationID: null,
                version: "1.0.0",
              }),
              GatewayCoalesce.catalog({
                api: backends.a.url,
                base: backends.a.url,
                token: "tok-1",
                organizationID: "selected",
                version: "1.0.0",
              }),
              GatewayCoalesce.catalog({
                api: backends.a.url,
                base: backends.a.url,
                token: undefined,
                organizationID: null,
                version: "1.0.0",
              }),
              GatewayCoalesce.catalog({
                api: backends.a.url,
                base: backends.a.url,
                token: "",
                organizationID: null,
                version: "1.0.0",
              }),
              GatewayCoalesce.catalog({
                api: backends.b.url,
                base: backends.b.url,
                token: "tok-1",
                organizationID: null,
                version: "1.0.0",
              }),
            ],
            { concurrency: 6 },
          )

          expect(personalA[0]._tag === "Success" && personalA[0].success.anonymous).toBe(false)
          expect(personalOtherToken[0]._tag === "Success" && personalOtherToken[0].success.anonymous).toBe(false)
          expect(teamA[0]._tag === "Success" && teamA[0].success.models.map((model) => model.id)).toEqual([
            "anthropic/claude-sonnet-4.6",
            "kilo-auto/small",
          ])
          expect(anonymousA[0]._tag === "Success" && anonymousA[0].success.anonymous).toBe(true)
          expect(emptyTokenA[0]._tag === "Success" && emptyTokenA[0].success.anonymous).toBe(false)
          expect(serverB[0]._tag === "Success" && serverB[0].success.models.map((model) => model.id)).toEqual([
            "server-b/model",
          ])
          // All 5 distinct scopes on backend A issued their own models request (none coalesced across distinct scopes).
          expect(backends.a.requests.filter((request) => request.path.endsWith("/models"))).toHaveLength(5)
          expect(backends.b.requests.filter((request) => request.path.endsWith("/models"))).toHaveLength(1)
        }),
      (backends) =>
        Effect.sync(() => {
          backends.a[Symbol.dispose]()
          backends.b[Symbol.dispose]()
        }),
    ),
  )
})
