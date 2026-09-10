import { expect, test } from "bun:test"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import type { Layout } from "../../kilo-cli/src/paths"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createAccountMethods } from "../src/backend/account"
import { createKiloClient } from "../src/backend/index"

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

function fixturePlugin() {
  return define({
    id: "kilocode.fixture-integration",
    effect: (ctx) =>
      ctx.integration.transform((editor) => {
        editor.update("fixture", (integration) => {
          integration.name = "Fixture Provider"
        })
        editor.method.update({ integrationID: "fixture", method: { type: "key", label: "API key" } })
      }),
  })
}

/** Loopback stand-in for the Kilo Cloud: device auth, profile, balance. */
function fakeKiloServer() {
  let armed = false
  let omitEmail = false
  let profileRequests = 0
  const requests: Array<string> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (request.method === "POST" && path === "/api/device-auth/codes") {
        return Response.json({
          code: "dev-1",
          verificationUrl: `${new URL(request.url).origin}/verify`,
          expiresIn: 600,
        })
      }
      if (request.method === "GET" && path === "/api/device-auth/codes/dev-1") {
        if (!armed) return new Response(null, { status: 202 })
        return Response.json({ status: "approved", token: "token-1", userEmail: "user@fixture.test" })
      }
      if (request.method === "GET" && path === "/api/profile") {
        profileRequests++
        return Response.json({
          ...(omitEmail ? {} : { user: { email: "user@fixture.test", name: "Fixture User" } }),
          organizations: [{ id: "org-1", name: "Fixture Org", role: "member" }],
          selectedOrganizationId: null,
          hasPersonalAccount: true,
        })
      }
      if (request.method === "GET" && path === "/api/profile/balance") {
        return Response.json({ balance: 42.5 })
      }
      return new Response(null, { status: 404 })
    },
  })
  return {
    server,
    get url() {
      return `http://127.0.0.1:${server.port}`
    },
    get requests() {
      return requests
    },
    arm() {
      armed = true
    },
    omitProfileEmail() {
      omitEmail = true
    },
    get profileRequests() {
      return profileRequests
    },
    stop() {
      server.stop(true)
    },
  }
}

test("account adapter translates v1 account/auth calls onto integrations, credentials, and the gateway", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-account-adapter-"))
  const [realProject] = await Promise.all([realpath(project)])
  const fake = fakeKiloServer()
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const created = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "kilo2-vscode-account-")))
          const layout = makeLayout(yield* Effect.promise(() => realpath(created)))
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            projectConfig: true,
            plugins: [fixturePlugin()],
            gateway: { server: fake.url, pollIntervalMs: 50 },
          })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          const account = createAccountMethods(verified.client, realProject)
          const facade = createKiloClient({ client: verified.client, directory: realProject })
          yield* Effect.promise(async () => {
            const at = { directory: realProject }

            // Unauthenticated: the gateway reports no active Kilo credential.
            expect((await account.kilo.authStatus({ directory: realProject }, { throwOnError: true })).data).toEqual({
              authenticated: false,
            })

            // The provider method list comes from the actual integration
            // registry: the fixture key integration and the gateway's Kilo
            // API-key + OAuth device methods. Plugin registrations settle
            // asynchronously at location load, so wait for them.
            let methods: Record<string, Array<{ type: "oauth" | "api"; label: string }>> | undefined
            for (let attempt = 0; attempt < 20; attempt++) {
              methods = (await facade.provider.auth({ directory: realProject }, { throwOnError: true })).data
              if (methods.fixture !== undefined && methods.kilo !== undefined) break
              await new Promise((resolve) => setTimeout(resolve, 250))
            }
            expect(methods!.fixture).toEqual([{ type: "api", label: "API key" }])
            expect(methods!.kilo).toEqual([
              { type: "api", label: "Kilo Gateway" },
              { type: "oauth", label: "Sign in with Kilo" },
            ])

            // API key connect stores an integration credential; unknown
            // providers and unexpected metadata refuse explicitly.
            // The first credential write after host start can hit an
            // intermittent 500 from the credential store (reported to the
            // parent); identical raw requests succeed, so retry bounded.
            let setResult = await account.auth.set({
              providerID: "fixture",
              auth: { type: "api", key: "key-1" },
              directory: realProject,
            })
            for (let attempt = 0; attempt < 3 && setResult.error; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 250))
              setResult = await account.auth.set({
                providerID: "fixture",
                auth: { type: "api", key: "key-1" },
                directory: realProject,
              })
            }
            const connected = (await verified.client.integration.list({ location: { directory: realProject } })).data
            const fixture = connected.find((item) => item.id === "fixture")
            expect(fixture?.connections.some((connection) => connection.type === "credential")).toBe(true)

            await expect(
              account.auth.set(
                {
                  providerID: "fixture",
                  auth: { type: "api", key: "key-1", metadata: { baseURL: "https://fixture.test" } },
                  directory: realProject,
                },
                { throwOnError: true },
              ),
            ).rejects.toThrow("does not accept credential metadata fields: baseURL")
            // Configured model providers gain key-method integrations from the
            // host's provider registry; only a provider with no integration
            // registration is refused.
            await expect(
              account.auth.set(
                { providerID: "not-a-real-integration", auth: { type: "api", key: "k" }, directory: realProject },
                { throwOnError: true },
              ),
            ).rejects.toThrow("No integration is registered for provider not-a-real-integration")

            // Kilo sign-out is credential removal and is idempotent.
            await account.auth.remove({ providerID: "fixture", directory: realProject }, { throwOnError: true })
            const cleared = (await verified.client.integration.list({ location: { directory: realProject } })).data
            expect(cleared.find((item) => item.id === "fixture")?.connections ?? []).toHaveLength(0)

            // The Kilo device flow: authorize takes the index into the
            // authorable method list (the OAuth entry is index 1 for kilo) and
            // preserves the pending attempt for the callback.
            const authorization = (
              await account.provider.oauth.authorize(
                { providerID: "kilo", method: 1, directory: realProject },
                { throwOnError: true },
              )
            ).data!
            fake.arm()
            expect(authorization.method).toBe("auto")
            expect(authorization.url.startsWith(fake.url)).toBe(true)
            expect(
              await account.provider.oauth.callback(
                { providerID: "kilo", method: 1, directory: realProject },
                { throwOnError: true },
              ),
            ).toBeDefined()

            // Signed in: the gateway profile maps onto the v1 account shape.
            const profile = (await account.kilo.profile({ directory: realProject }, { throwOnError: true })).data!
            expect(profile.profile.email).toBe("user@fixture.test")
            expect(profile.profile.organizations).toEqual([{ id: "org-1", name: "Fixture Org", role: "member" }])
            expect(profile.balance).toEqual({ balance: 42.5 })
            expect(profile.kiloPass).toBeNull()
            expect((await account.kilo.authStatus({ directory: realProject }, { throwOnError: true })).data).toEqual({
              authenticated: true,
            })

            // Auth presence follows the stored credential, not the profile:
            // with the email stripped the account is still signed in, and a
            // transport failure surfaces as an error instead of signed-out.
            fake.omitProfileEmail()
            expect((await account.kilo.authStatus({ directory: realProject }, { throwOnError: true })).data).toEqual({
              authenticated: true,
            })
            const failed = await account.kilo.authStatus({ directory: realProject }, { signal: AbortSignal.abort() })
            expect(failed.error).toBeDefined()

            // Organization selection validates against the account's orgs.
            const switched = (
              await account.kilo.organization.set(
                { organizationId: "org-1", directory: realProject },
                { throwOnError: true },
              )
            ).data!
            expect(switched.currentOrgId).toBe("org-1")
            await expect(
              account.kilo.organization.set(
                { organizationId: "bogus", directory: realProject },
                { throwOnError: true },
              ),
            ).rejects.toThrow("not available")

            // A pending attempt is required for the callback; unknown method
            // indexes refuse.
            await expect(
              account.provider.oauth.callback(
                { providerID: "kilo", method: 1, directory: realProject },
                { throwOnError: true },
              ),
            ).rejects.toThrow("No pending provider authorization")
            await expect(
              account.provider.oauth.authorize(
                { providerID: "kilo", method: 5, directory: realProject },
                { throwOnError: true },
              ),
            ).rejects.toThrow("is not an OAuth method")

            // Logout removes the Kilo credential; status drops to signed out.
            await account.auth.remove({ providerID: "kilo", directory: realProject }, { throwOnError: true })
            expect((await account.kilo.authStatus({ directory: realProject }, { throwOnError: true })).data).toEqual({
              authenticated: false,
            })
          })
        }),
      ),
    )
  } finally {
    fake.stop()
    await rm(project, { recursive: true, force: true })
  }
}, 45_000)
