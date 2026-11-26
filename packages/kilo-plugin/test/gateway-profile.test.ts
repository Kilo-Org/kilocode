import { describe, expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const integrationID = Integration.ID.make("kilo")
const env = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_API_URL: undefined,
  KILO_AI_GATEWAY_URL: undefined,
  KILO_ORG_ID: undefined,
}

const addPlugin = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = integrationID
      provider.package = "@opencode/ai/providers/openai-compatible"
    })
    editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* KiloPlugin.effect(host)
  yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
})

const oauthCredential = () =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: IntegrationMethodID.make("device"),
    access: "oauth-token",
    refresh: "oauth-refresh",
    expires: 4_102_444_800_000,
  })

describe("KiloGatewayPlugin profile and authStatus RPCs", () => {
  it.live("maps profile 200, missing credential, 401/403, 500, schema and network failures", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            const client = rpc.client(KiloGatewayRpc.Definition)

            expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })
            expect(yield* client.authStatus({})).toEqual({
              authenticated: false,
              organizationID: null,
              server: backend.url,
            })

            const credentials = yield* Credential.Service
            yield* credentials.create({ integrationID, label: "OAuth", value: oauthCredential() })
            yield* Effect.scoped(addPlugin())

            expect(yield* client.profile({})).toMatchObject({ email: "profile@example.test", name: "Fixture" })
            expect(yield* client.authStatus({})).toMatchObject({ authenticated: true, method: "oauth" })

            backend.state.profileStatus = 401
            expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })
            expect(yield* client.authStatus({})).toMatchObject({ authenticated: true, method: "oauth" })

            backend.state.profileStatus = 403
            expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })

            backend.state.profileStatus = 500
            expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "failed" })

            backend.state.profileStatus = 200
            backend.state.profile = { organizations: "invalid" }
            expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "failed" })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("maps profile network errors to failed", () =>
    Effect.gen(function* () {
      const backend = fixture()
      const url = backend.url
      backend[Symbol.dispose]()
      yield* withEnv({ ...env, KILO_API_URL: url, KILO_API_KEY: "env-token" }, () =>
        Effect.gen(function* () {
          yield* addPlugin()
          const client = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
          expect(yield* client.profile({}).pipe(Effect.flip)).toMatchObject({ type: "failed" })
        }),
      )
    }),
  )

  it.live("reports authStatus.method for stored key credentials", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "API Key",
              value: Credential.Key.make({ type: "key", key: "stored-key" }),
            })
            yield* addPlugin()
            const client = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            expect(yield* client.authStatus({})).toMatchObject({ authenticated: true, method: "key" })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("omits authStatus.method when an env token overrides a stored OAuth credential", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "env-token" }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({ integrationID, label: "OAuth", value: oauthCredential(), activate: true })
            yield* addPlugin()
            const client = (yield* Rpc.Service).client(KiloGatewayRpc.Definition)
            const status = yield* client.authStatus({})
            expect(status.authenticated).toBe(true)
            expect(status.method).toBeUndefined()
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )
})
