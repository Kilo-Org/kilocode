import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { KiloSessionSync } from "@kilocode/kilo-plugin"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { SessionProjector } from "@opencode/core/session/projector"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionSync } from "../src/session-sync"
import { loadPlugins } from "./lib/plugins"

// The reference Kilo RPC end to end: the contract in @opencode/schema, the handlers in the Gateway plugin of
// packages/kilo-plugin, the plugin registered by the host overrides, and the call through the generated client's
// `rpc` entry point (`POST /api/rpc/:rpcID/:method`), as the TUI and the IDE clients make it. A local stand-in for
// the Kilo API answers the Gateway.
const boot =
  (
    env: Record<string, string>,
    body: (rpc: ReturnType<typeof gateway>, backend: ReturnType<typeof fixture>) => Promise<void>,
    // `data` is the server's global data directory, where a new store looks for an `auth.json` to import.
    // `database` opens a file store; an in-memory store never imports a legacy login.
    options: { syncBackground?: boolean; awaitActivation?: boolean; data?: string; database?: string } = {},
  ) =>
  async () => {
  using backend = fixture()
  const syncOrganizations: (string | null)[] = []
  const syncScopes: (string | null | undefined)[] = []
  const syncPeer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/auth/exchange") return new Response(null, { status: 404 })
      const input = await request.json() as { organizationID?: string }
      const organizationID = input.organizationID ?? null
      syncOrganizations.push(organizationID)
      return Response.json({
        version: 1,
        token: "sync-fixture-grant",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        userID: "fixture",
        tenant: organizationID ? { type: "organization", id: organizationID } : { type: "user", id: "fixture" },
      })
    },
  })
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-rpc-"))
  // Keep a developer's Kilo login out of the test.
  const variables = { ...signedOut, KILO_API_URL: backend.url, ...env }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: options.database ?? ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory, project: false },
              },
              () => [],
              [
                ...KiloHost.overrides,
                SessionSync.node.replace(makeGlobalNode({
                  service: KiloSessionSync.Service,
                  layer: Layer.effect(KiloSessionSync.Service, Effect.gen(function* () {
                    const sync = yield* SessionSync.make({
                      background: options.syncBackground ?? false,
                      destination: syncPeer.url.origin,
                    })
                    return KiloSessionSync.Service.of({
                      ...sync,
                      organization: (input) => Effect.gen(function* () {
                        syncScopes.push(input.organizationID)
                        yield* sync.organization(input)
                      }),
                    })
                  })),
                  deps: [Database.node, Bus.node, SessionProjector.node, Credential.node, Global.node],
                })),
                ...(options.data
                  ? [Global.node.replace(Global.layerWith({ config: directory, data: options.data }))]
                  : []),
              ],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const client = OpenCode.make({
            baseUrl: "http://kilo.local",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            // The client sends its requests to the server in this process instead of the network.
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          // The server no longer waits for a Location's plugins in rpc.call, so a one-shot caller waits itself.
          const ready = loadPlugins(context, directory)
          // A test that asserts intermediate activation state opts out and awaits `gateway.ready()` itself once its
          // fixture is in place.
          if (options.awaitActivation !== false) yield* ready
          yield* Effect.promise(() =>
            body(gateway(client, directory, backend.url, syncOrganizations, syncScopes, ready), backend),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    syncPeer.stop(true)
    apply(previous)
    await rm(directory, { recursive: true, force: true })
  }
}

const signedOut = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_ORG_ID: undefined,
  KILO_AI_GATEWAY_URL: undefined,
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

function gateway(
  client: ReturnType<typeof OpenCode.make>,
  directory: string,
  server: string,
  syncOrganizations: (string | null)[],
  syncScopes: (string | null | undefined)[],
  ready: Effect.Effect<void, unknown>,
) {
  return {
    client,
    rpc: client.rpc(KiloGatewayRpc.Definition),
    sync: client.rpc(KiloSessionSyncRpc.Definition),
    options: { location: { directory } },
    server,
    syncOrganizations,
    syncScopes,
    // Waits for the Location's plugins to finish registering, so a one-shot caller can dispatch the RPC.
    ready: () => Effect.runPromise(ready),
  }
}

test(
  "a signed-out client reads the Gateway state and catalog through the generated client",
  boot({}, async (gateway) => {
    expect(await gateway.rpc.authStatus({}, gateway.options)).toEqual({
      authenticated: false,
      organizationID: null,
      server: gateway.server,
    })
    const models = await gateway.rpc.models({}, gateway.options)
    expect(models.find((model) => model.id === "kilo-auto/free")).toMatchObject({
      name: "Kilo Auto Free",
      isFree: true,
    })
    // A handler error keeps its contract name through the HTTP route.
    await expect(gateway.rpc.profile({}, gateway.options)).rejects.toMatchObject({
      type: "unauthorized",
      message: "Not signed in to Kilo Gateway",
    })
  }),
  30_000,
)

test(
  "a signed-in client reads the profile and switches the team through the generated client",
  boot({ KILO_API_KEY: "fixture-token" }, async (gateway) => {
    expect(await gateway.rpc.profile({}, gateway.options)).toEqual({
      email: "profile@example.test",
      name: "Fixture",
      organizations: [
        { id: "first", name: "First", role: "member" },
        { id: "selected", name: "Selected", role: "owner" },
      ],
      hasPersonalAccount: true,
      organizationID: null,
    })
    const personal = await gateway.rpc.authStatus({}, gateway.options)
    expect(personal).toMatchObject({ authenticated: true, organizationID: null, server: gateway.server })
    expect(personal.identity).toMatch(/^catalog:personal:[0-9a-f]{64}$/)
    expect(await gateway.rpc["organization.set"]({ organizationID: "first" }, gateway.options)).toEqual({})
    expect(await gateway.rpc.authStatus({}, gateway.options)).toEqual({
      authenticated: true,
      organizationID: "first",
      server: gateway.server,
    })
  }),
  30_000,
)

// The team a Kilo v1 login on this machine used last, in v1's `auth.json`. The backend selects another one.
const v1Login = (access: string) =>
  JSON.stringify({ kilo: { type: "oauth", access, refresh: access, expires: 4_102_444_800_000, accountId: "first" } })

for (const hasPersonalAccount of [true, false])
  test(`a new store keeps the team of an imported Kilo v1 login (Personal: ${hasPersonalAccount})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-v1-import-"))
    // Once the release renames the kilo2 data directory to `kilo`, it is v1's own, and a new store imports v1's
    // auth.json through the upstream `import_legacy_credentials` migration.
    const data = path.join(root, "kilo")
    const auth = v1Login("fixture-token")
    await Bun.write(path.join(data, "auth.json"), auth)
    try {
      await boot(
        {},
        async (gateway, backend) => {
          backend.state.profile = {
            user: { email: "profile@example.test" },
            organizations: [
              { id: "first", name: "First" },
              { id: "selected", name: "Selected" },
            ],
            selectedOrganizationId: "selected",
            hasPersonalAccount,
          }
          await gateway.ready()
          await until(
            () => backend.requests.some((request) => request.path.endsWith("/models")),
            "the imported login loads its catalog",
          )
          expect(
            backend.requests.filter((request) => request.path.endsWith("/models")).map((request) => request.path),
          ).toEqual(["/api/gateway/v1/organizations/first/models"])
          expect(await gateway.rpc.authStatus({}, gateway.options)).toEqual({
            authenticated: true,
            organizationID: "first",
            server: gateway.server,
          })
        },
        { data, database: path.join(data, "kilo2-v2.db"), awaitActivation: false },
      )()
      expect(await Bun.file(path.join(data, "auth.json")).text()).toBe(auth)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

test("a device sign-in starts on the team of the Kilo v1 login beside the kilo2 data directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-v1-signin-"))
  const file = path.join(root, "kilo", "auth.json")
  const auth = v1Login("v1-token")
  await Bun.write(file, auth)
  try {
    await boot(
      {},
      async (gateway, backend) => {
        backend.state.pending = 0
        const input = { ...gateway.options, integrationID: "kilo" }
        const attempt = await gateway.client.integration.oauth.connect({ ...input, methodID: "device" })
        await eventually(
          () => gateway.client.integration.oauth.status({ ...input, attemptID: attempt.data.attemptID }),
          (status) => status.data.status !== "pending",
          "the device sign-in completes",
        )
        expect((await gateway.client.credential.list()).map((credential) => credential.value)).toEqual([
          expect.objectContaining({
            access: "fixture-token",
            metadata: expect.objectContaining({ organizationID: "first" }),
          }),
        ])
        expect(
          await eventually(
            () => gateway.rpc.authStatus({}, gateway.options),
            (status) => status.authenticated,
            "the Gateway uses the new login",
          ),
        ).toEqual({ authenticated: true, organizationID: "first", server: gateway.server })
      },
      { data: path.join(root, "kilo2") },
    )()
    expect(await Bun.file(file).text()).toBe(auth)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test(
  "automatic sync enrollment follows the Gateway selection and pauses on an organization switch",
  boot({ KILO_API_KEY: "fixture-token" }, async (gateway) => {
    const directory = gateway.options.location.directory
    await gateway.rpc["organization.set"]({ organizationID: "first" }, gateway.options)
    expect(await gateway.sync.status({ directory }, gateway.options)).toMatchObject({
      enabled: true,
      tenant: { type: "organization", id: "first" },
    })
    expect(gateway.syncOrganizations).toEqual(["first"])
    await gateway.rpc["organization.set"]({ organizationID: "selected" }, gateway.options)
    expect(await gateway.sync.status({ directory }, gateway.options)).toMatchObject({
      enabled: false,
      tenant: { type: "organization", id: "first" },
      error: { code: "account_changed" },
    })
    expect(gateway.syncOrganizations).toEqual(["first"])
    await gateway.rpc["organization.set"]({ organizationID: "first" }, gateway.options)
    const resumed = await gateway.sync.status({ directory }, gateway.options)
    expect(resumed.enabled).toBe(true)
    expect(resumed.error).toBeUndefined()
  }),
  30_000,
)

test(
  "a team-only login never enrolls provisionally as Personal while its default organization resolves",
  boot({ KILO_API_KEY: "fixture-token" }, async (gateway, backend) => {
    const profileReady = Promise.withResolvers<void>()
    backend.state.profilePending = profileReady.promise
    backend.state.profile = {
      user: { email: "team-only@example.test", name: "Team fixture" },
      organizations: [{ id: "selected", name: "Selected", role: "owner" }],
      selectedOrganizationId: "selected",
      hasPersonalAccount: false,
    }
    // The server no longer waits for plugins in rpc.call, so this one-shot caller awaits activation before it calls.
    // Activation registers the RPC and starts the login's catalog resolution, which blocks on the pending profile, so
    // no organization resolves yet.
    await gateway.ready()
    try {
      await until(() => backend.requests.some((request) => request.path === "/api/profile"), "the unresolved profile request reaches the peer")
      expect(gateway.syncScopes.length).toBeGreaterThan(0)
      expect(gateway.syncScopes.every((scope) => scope === undefined)).toBe(true)
      expect(gateway.syncOrganizations).toEqual([])
      // rpc.call no longer waits for the login's catalog resolution, so authStatus reports no organization yet.
      // Before upstream v2.2.7 this call waited and returned the organization.
      expect(await gateway.rpc.authStatus({}, gateway.options)).toMatchObject({ authenticated: true, organizationID: null })
      profileReady.resolve()
      await until(() => gateway.syncOrganizations.includes("selected"), "automatic organization enrollment reaches the peer")
      // Catalog resolution settles after the enrollment reaches the peer, so authStatus reads null for a while.
      expect(
        await eventually(
          () => gateway.rpc.authStatus({}, gateway.options),
          (status) => status.organizationID === "selected",
          "authStatus reports the resolved organization",
        ),
      ).toMatchObject({ authenticated: true, organizationID: "selected" })
      const directory = gateway.options.location.directory
      const status = await gateway.sync.status({ directory }, gateway.options)
      expect(status).toMatchObject({ enabled: true, tenant: { type: "organization", id: "selected" } })
      expect(status.error).toBeUndefined()
      expect(gateway.syncOrganizations.every((scope) => scope === "selected")).toBe(true)
      expect(gateway.syncScopes.filter((scope) => scope !== undefined)).toEqual(["selected"])
    } finally {
      profileReady.resolve()
    }
  }, { syncBackground: true, awaitActivation: false }),
  30_000,
)

test(
  "catalog failure data crosses the generated client without private scope details",
  boot({ KILO_API_KEY: "private-fixture-token", KILO_ORG_ID: "private-missing-team" }, async (gateway) => {
    await expect(gateway.rpc.models({}, gateway.options)).rejects.toMatchObject({
      type: "failed",
      message: "The selected Kilo team is no longer available. Select another team or clear the team selection.",
      data: { kind: "organization_missing" },
    })
  }),
  30_000,
)

test(
  "signed-out sync RPC status and flush do not enroll a workspace",
  boot({}, async (gateway) => {
    const directory = gateway.options.location.directory
    expect((await gateway.sync.status({ directory }, gateway.options)).enabled).toBe(false)
    await expect(gateway.sync.flush({ directory }, gateway.options)).rejects.toMatchObject({
      type: "failed",
      data: { code: "sync_disabled" },
    })
  }),
  30_000,
)

test(
  "sync RPC requires a credential before accepting workspace consent",
  boot({}, async (gateway) => {
    const directory = gateway.options.location.directory
    await expect(
      gateway.sync.enable(
        {
          directory,
          organizationID: null,
        },
        gateway.options,
      ),
    ).rejects.toMatchObject({
      type: "failed",
      data: { code: "credential_unavailable" },
    })
    expect((await gateway.sync.status({ directory }, gateway.options)).enabled).toBe(false)
  }),
  30_000,
)

test(
  "an autocomplete request crosses the generated client, and a client abort cancels the provider request",
  boot({ KILO_API_KEY: "fixture-token" }, async (gateway, backend) => {
    expect(await gateway.rpc["autocomplete.fim"]({ prefix: "const a = ", suffix: "" }, gateway.options)).toEqual({
      text: "fixture completion",
      cost: 0.0001,
      inputTokens: 5,
      outputTokens: 2,
    })
    backend.state.fimHang = true
    const abort = new AbortController()
    const pending = gateway.rpc["autocomplete.fim"]({ prefix: "", suffix: "" }, { ...gateway.options, signal: abort.signal })
    await until(() => backend.state.autocompleteRequests.length >= 2, "the hung FIM request reached the fixture")
    abort.abort()
    expect(await pending.then(() => false, () => true)).toBe(true)
    await until(() => backend.state.fimAborted === 1, "the fixture saw the aborted FIM request")
  }),
  30_000,
)

test(
  "an autocomplete failure keeps its status through the generated client",
  boot({}, async (gateway, backend) => {
    await expect(gateway.rpc["autocomplete.fim"]({ prefix: "", suffix: "" }, gateway.options)).rejects.toMatchObject({
      type: "unauthorized",
      message: "Not authenticated with Kilo Gateway",
    })
    expect(backend.state.autocompleteRequests).toEqual([])
  }),
  30_000,
)

/** Waits for a condition, so a missing signal fails the test instead of passing every assertion. */
async function until(condition: () => boolean, what: string, timeout = 5_000) {
  for (const start = Date.now(); Date.now() - start < timeout; await Bun.sleep(5)) {
    if (condition()) return
  }
  throw new Error(`Timed out waiting until ${what}`)
}

async function eventually<A>(read: () => Promise<A>, done: (value: A) => boolean, what: string, timeout = 10_000) {
  for (const start = Date.now(); Date.now() - start < timeout; await Bun.sleep(10)) {
    const value = await read()
    if (done(value)) return value
  }
  throw new Error(`Timed out waiting until ${what}`)
}
