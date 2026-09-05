import { expect, test } from "bun:test"
import type { CatalogEditor, CatalogProviderRecord } from "@opencode-ai/plugin/effect/catalog"
import type { IntegrationEditor, IntegrationMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import type { RpcCallContext, RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { Agent } from "@opencode-ai/schema/agent"
import { Document, Event as ConfigEvent, Info, type Config } from "@opencode-ai/schema/config"
import { ConfigProvider } from "@opencode-ai/schema/config/provider"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { IntegrationID, IntegrationMethodID } from "@opencode-ai/schema/integration-id"
import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Money } from "@opencode-ai/schema/money"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { Deferred, Effect, PubSub, Schema, Stream, Types } from "effect"
import {
  createGatewayPlugin,
  deviceAuth,
  registerGateway,
  type GatewayContext,
  type GatewayExtension,
} from "../src/index.js"
import { fixture } from "./fixture.js"

const harness = Effect.fn(function* (
  input: {
    storage?: Map<string, Schema.Json>
    connectionID?: Credential.ID
    configuredModelPackage?: string
    /** Pre-folded values simulating the host config fold, which runs before the Gateway transform. */
    fixtureModel?: Partial<Model.Info>
  } = {},
) {
  const changes = yield* PubSub.unbounded<Stream.Success<ReturnType<GatewayContext["event"]["subscribe"]>>>()
  const catalogTransforms: ((editor: CatalogEditor) => void)[] = []
  const sessionHooks: ((event: SessionHooks["http.request"]) => Effect.Effect<void>)[] = []
  const methods = new Map<string, IntegrationMethodRegistration>([
    ["key", { integrationID: "kilo", method: { type: "key" } }],
  ])
  const storage = input.storage ?? new Map<string, Schema.Json>()
  const rpc: {
    gateway?: RpcHandlers<typeof KiloGateway.Definition>
    models?: RpcHandlers<typeof KiloModels.Definition>
  } = {}
  const seed: CatalogProviderRecord = {
    provider: {
      id: Provider.ID.make("kilo"),
      name: "Kilo",
      activation: "auto",
      package: "npm:@ai-sdk/openai-compatible",
      settings: { baseURL: "https://api.kilo.ai/api/gateway" },
      headers: { "x-kilocode-organizationid": "stale", Existing: "preserved" },
    },
    models: new Map([
      [
        "fixture",
        ((): Types.DeepMutable<Model.Info> => {
          const model: Types.DeepMutable<Model.Info> = {
            ...Model.Info.default(Provider.ID.make("kilo"), Model.ID.make("fixture")),
            ...(input.configuredModelPackage === undefined ? {} : { package: input.configuredModelPackage }),
            headers: { "X-KILOCODE-ORGANIZATIONID": "stale-model" },
            variants: [
              { id: Model.VariantID.make("variant"), headers: { "x-kilocode-organizationid": "stale-variant" } },
            ],
          }
          Object.assign(model, input.fixtureModel)
          return model
        })(),
      ],
    ]),
  }
  const connection = {
    type: "credential" as const,
    id: input.connectionID ?? Credential.ID.create(),
    label: "Fixture active",
  }
  const state = {
    credential: undefined as Credential.Value | undefined,
    resolutionFails: false,
    // Reload rebuilds from this seed, mirroring the host's static + config-fold base state;
    // tests replace it to simulate a changed configuration before a config.updated event.
    seed,
    record: structuredClone(seed),
    updated: yield* Deferred.make<void>(),
    activeCalls: 0,
    reloadFailures: 0,
    integration: { id: IntegrationID.make("kilo"), name: "Kilo" },
  }
  const editor: CatalogEditor = {
    provider: {
      list: () => [state.record],
      get: (id) => (id === state.record.provider.id ? state.record : undefined),
      update: (id, update) => {
        if (id === state.record.provider.id) update(state.record.provider)
      },
      remove: () => {
        throw new Error("Unexpected provider removal")
      },
    },
    model: {
      get: (_, id) => state.record.models.get(id),
      update: (_, id, update) => {
        const model = state.record.models.get(id) ?? Model.Info.default(Provider.ID.make("kilo"), Model.ID.make(id))
        if (!state.record.models.has(id))
          state.record = { ...state.record, models: new Map([...state.record.models, [id, model]]) }
        update(model)
      },
      remove: () => {
        throw new Error("Unexpected model removal")
      },
      default: {
        get: () => undefined,
        set: () => {
          throw new Error("Unexpected default selection")
        },
      },
    },
  }
  const integration: IntegrationEditor = {
    list: () => [state.integration],
    get: (id) => (id === "kilo" ? state.integration : undefined),
    update: (id, update) => {
      if (id !== "kilo") throw new Error("Unexpected integration update")
      update(state.integration)
    },
    remove: () => {
      throw new Error("Unexpected integration removal")
    },
    method: {
      list: () => [...methods.values()].map((item) => item.method),
      update: (input) => methods.set(input.method.type === "oauth" ? input.method.id : input.method.type, input),
      remove: () => {
        throw new Error("Existing key auth must be preserved")
      },
    },
  }
  const directory = AbsolutePath.make("/fixture")
  const ctx: GatewayContext = {
    location: new Location.Info({
      directory,
      project: { id: Project.ID.make("fixture"), directory, canonical: directory },
    }),
    integration: {
      transform: (callback) =>
        Effect.sync(() => {
          callback(integration)
          return { dispose: Effect.void }
        }),
      connection: {
        active: (id) =>
          Effect.sync(() => {
            expect(id).toBe("kilo")
            state.activeCalls++
            return state.credential ? connection : undefined
          }),
        resolve: (input) =>
          Effect.suspend(() => {
            expect(input).toBe(connection)
            return state.resolutionFails ? Effect.fail(new Error("fixture failure")) : Effect.succeed(state.credential)
          }),
      },
    },
    catalog: {
      transform: (callback) =>
        Effect.sync(() => {
          catalogTransforms.push(callback)
          return { dispose: Effect.void }
        }),
      reload: () =>
        Effect.gen(function* () {
          if (state.reloadFailures > 0) {
            state.reloadFailures--
            yield* Effect.die(new Error("fixture catalog failure"))
          }
          state.record = structuredClone(state.seed)
          catalogTransforms.forEach((callback) => callback(editor))
        }).pipe(
          Effect.andThen(() => Deferred.succeed(state.updated, undefined)),
          Effect.asVoid,
        ),
    },
    event: { subscribe: () => Stream.fromPubSub(changes) },
    session: {
      hook: (name, callback) =>
        Effect.sync(() => {
          if (name === "http.request") {
            // The hook signature is dependent on its name; this narrowed branch is its concrete host entrypoint.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            sessionHooks.push(callback as unknown as (event: SessionHooks["http.request"]) => Effect.Effect<void>)
          }
          return { dispose: Effect.void }
        }),
    },
    rpc: {
      register: (definition, handlers) =>
        Effect.sync(() => {
          if (definition.id === KiloGateway.Definition.id) {
            // The fixture only accepts this definition and preserves its correlated handler type.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            rpc.gateway = handlers as unknown as RpcHandlers<typeof KiloGateway.Definition>
          }
          if (definition.id === KiloModels.Definition.id) {
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            rpc.models = handlers as unknown as RpcHandlers<typeof KiloModels.Definition>
          }
          return { dispose: Effect.void, events: { emit: () => Effect.void } }
        }),
    },
    storage: {
      get: (key) => Effect.sync(() => storage.get(key)),
      set: (key, value) => Effect.sync(() => storage.set(key, value)).pipe(Effect.asVoid),
      remove: (key) => Effect.sync(() => storage.delete(key)).pipe(Effect.asVoid),
    },
  }
  const notify = Effect.fn(function* () {
    state.updated = yield* Deferred.make<void>()
    yield* PubSub.publish(
      changes,
      Credential.Event.Switched.make({
        id: Event.ID.create(),
        created: Date.now(),
        data: { integrationID: IntegrationID.make("kilo"), credentialID: state.credential ? connection.id : null },
        type: "credential.switched",
      }),
    )
    yield* Deferred.await(state.updated)
  })
  const notifyConfig = Effect.fn(function* () {
    state.updated = yield* Deferred.make<void>()
    yield* PubSub.publish(
      changes,
      ConfigEvent.Updated.make({ id: Event.ID.create(), created: Date.now(), type: "config.updated", data: {} }),
    )
    yield* Deferred.await(state.updated)
  })
  return {
    ctx,
    state,
    methods,
    notify,
    notifyConfig,
    storage,
    connectionID: connection.id,
    rpc: () => {
      if (!rpc.gateway) throw new Error("Gateway RPC was not registered")
      return rpc.gateway
    },
    models: () => {
      if (!rpc.models) throw new Error("Model metadata RPC was not registered")
      return rpc.models
    },
    httpRequest: (request: Request) => {
      const event: SessionHooks["http.request"] = {
        sessionID: Session.ID.create(),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("fixture"), providerID: Provider.ID.make("kilo") }),
        request,
      }
      return Effect.forEach(sessionHooks, (hook) => hook(event), { discard: true }).pipe(
        Effect.andThen(() => Effect.sync(() => event.request)),
      )
    },
  }
})

function cost(input: number, output: number): Model.Cost {
  return {
    input: Money.USDPerMillionTokens.make(input),
    output: Money.USDPerMillionTokens.make(output),
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  }
}

function call<M extends (typeof KiloGateway.Definition.methods)[keyof typeof KiloGateway.Definition.methods]>() {
  // The production host brands the same type/message object after validating it against the definition.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return {
    error: (type: string, message: string) => ({ type, message }),
  } as unknown as RpcCallContext<M>
}

test("host extensions resolve current validated accounts without adding a credential RPC", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = { type: "key", key: "extension-secret", metadata: { server: backend.url } }
      const resolver = yield* Deferred.make<Parameters<GatewayExtension>[1]>()
      yield* registerGateway(host.ctx, { server: backend.url }, undefined, undefined, (_, account) =>
        Deferred.succeed(resolver, account).pipe(Effect.asVoid),
      )
      const account = yield* Deferred.await(resolver)
      expect(yield* account).toEqual({ token: "extension-secret", server: backend.url, organizationID: "selected" })
      expect(JSON.stringify(yield* host.rpc().profile({}, call()))).not.toContain("extension-secret")
      yield* host.rpc()["organization.set"]({ organizationID: null }, call())
      expect((yield* account).organizationID).toBeNull()
      host.storage.set(`organization:${host.connectionID}`, { organizationID: "unavailable" })
      expect(yield* account.pipe(Effect.flip)).toMatchObject({
        type: "kilocode.gateway",
        message: "The selected Kilo account is not available",
      })
      host.state.credential = undefined
      expect(yield* account.pipe(Effect.flip)).toMatchObject({ type: "kilocode.gateway" })
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  )
})

test("public adapter registers auth and reloads provider, model and variant routing on active credential changes", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      expect(createGatewayPlugin().id).toBe("kilocode.gateway")
      yield* registerGateway(host.ctx, { server: backend.url, pollIntervalMs: 1 })
      expect(host.state.integration.name).toBe("Kilo Gateway")
      const method = host.methods.get("device")
      expect(method?.integrationID).toBe("kilo")
      expect(host.methods.has("key")).toBe(true)
      if (!method || !("authorize" in method)) throw new Error("Device auth was not registered")
      const authorization = yield* method.authorize({})
      if (authorization.mode !== "auto") throw new Error("Expected automatic authorization")
      host.state.credential = yield* authorization.callback
      yield* host.notify()
      const assertHeaders = (organizationID: string | null) => {
        const model = host.state.record.models.get("fixture")!
        for (const item of [host.state.record.provider, model, ...model.variants]) {
          expect(item.settings?.baseURL).toBe(`${backend.url}/api/gateway`)
          expect(item.headers?.["X-KILOCODE-ORGANIZATIONID"]).toBe(organizationID ?? undefined)
          expect(item.headers).not.toHaveProperty("x-kilocode-organizationid")
        }
        expect(host.state.record.provider.headers?.Existing).toBe("preserved")
      }
      assertHeaders("selected")
      backend.state.profile = {
        email: "personal@example.test",
        organizations: [],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      }
      const personal = yield* deviceAuth({ server: backend.url }).authorize({})
      if (personal.mode !== "auto") throw new Error("Expected automatic authorization")
      host.state.credential = yield* personal.callback
      yield* host.notify()
      assertHeaders(null)
      host.state.credential = undefined
      yield* host.notify()
      assertHeaders(null)
      expect(host.state.activeCalls).toBeGreaterThanOrEqual(4)
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  )
})

test("saved credential server wins over host default; invalid active metadata disables the catalog", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      const authorization = yield* deviceAuth({ server: backend.url }).authorize({})
      if (authorization.mode !== "auto") throw new Error("Expected automatic authorization")
      host.state.credential = yield* authorization.callback
      yield* registerGateway(host.ctx)
      expect(host.state.record.provider.settings?.baseURL).toBe(`${backend.url}/api/gateway`)
      host.state.credential = { ...host.state.credential, metadata: { server: 42 } }
      yield* host.notify()
      expect(host.state.record.provider.activation).toBe("disabled")
      expect(host.state.record.models.get("fixture")?.enabled).toBe(false)
      host.state.credential = { type: "key", key: "fixture-key", metadata: { server: backend.url } }
      yield* host.notify()
      expect(host.state.record.provider.activation).toBe("auto")
      expect(host.state.record.provider.headers?.["X-KILOCODE-ORGANIZATIONID"]).toBe("selected")
      host.state.resolutionFails = true
      yield* host.notify()
      expect(host.state.record.provider.activation).toBe("disabled")
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  )
})

test("RPC reads and persists account selection without exposing or mutating the credential", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.OAuth.make({
        type: "oauth",
        methodID: IntegrationMethodID.make("device"),
        access: "private-access-token",
        refresh: "private-refresh-token",
        expires: 0,
        metadata: { server: backend.url, organizationID: "selected", retained: true },
      })
      const original = structuredClone(host.state.credential)
      yield* registerGateway(host.ctx, { server: backend.url })
      const initial = yield* host.rpc().profile({}, call())
      expect(initial.currentOrganizationID).toBe("selected")
      expect(JSON.stringify(initial)).not.toContain("private-access-token")
      const selected = yield* host.rpc()["organization.set"]({ organizationID: "first" }, call())
      expect(selected.currentOrganizationID).toBe("first")
      expect([...host.storage.values()]).toEqual([{ organizationID: "first" }])
      expect((yield* host.rpc().profile({}, call())).currentOrganizationID).toBe("first")
      expect(host.state.credential).toEqual(original)
      expect(backend.requests.at(-1)?.authorization).toBe("Bearer private-access-token")
      const reactivated = yield* harness({ storage: host.storage, connectionID: host.connectionID })
      reactivated.state.credential = host.state.credential
      yield* registerGateway(reactivated.ctx, { server: backend.url })
      expect((yield* reactivated.rpc().profile({}, call())).currentOrganizationID).toBe("first")
    }).pipe(Effect.scoped),
  )
})

test("balance RPC returns independently optional account metadata for the selected scope", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.OAuth.make({
        type: "oauth",
        methodID: IntegrationMethodID.make("device"),
        access: "private-access-token",
        refresh: "private-refresh-token",
        expires: 0,
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      backend.state.balanceStatus = 503

      expect(yield* host.rpc().balance({}, call())).toEqual({
        currentOrganizationID: "selected",
        balance: null,
        kiloPass: null,
      })
      expect(yield* host.rpc().profile({}, call())).toMatchObject({
        currentOrganizationID: "selected",
        selectionAvailable: true,
      })
      expect(backend.requests.at(-1)).toMatchObject({
        path: "/api/profile",
        authorization: "Bearer private-access-token",
      })
      expect(backend.requests.find((request) => request.path === "/api/profile/balance")).toMatchObject({
        organizationID: "selected",
      })

      backend.state.balanceStatus = 200
      yield* host.rpc()["organization.set"]({ organizationID: null }, call())
      expect(yield* host.rpc().balance({}, call())).toMatchObject({
        currentOrganizationID: null,
        balance: { balance: 42.5 },
        kiloPass: { currentPeriodBaseCreditsUsd: 19 },
      })
    }).pipe(Effect.scoped),
  )
})

test("model metadata RPC uses the validated account scope", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      expect(yield* host.models().list({}, call())).toEqual([
        { id: "kilo/auto", recommendedIndex: 1, autoRouting: { models: ["kilo/balanced", "kilo/free"] } },
        { id: "kilo/balanced", recommendedIndex: 2 },
      ])
      expect(backend.requests.at(-1)).toMatchObject({
        path: "/api/organizations/selected/models",
        authorization: "Bearer private-key",
        organizationID: "selected",
      })
    }).pipe(Effect.scoped),
  )
})

test("catalog drops malformed optional Auto routing without dropping its valid model", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "kilo/auto",
        name: "Kilo Auto",
        context_length: 128000,
        supported_parameters: ["tools"],
        autoRouting: { models: "not-an-array" },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      expect(yield* host.models().list({}, call())).toEqual([{ id: "kilo/auto" }])
      expect(host.state.record.models.get("kilo/auto")).toMatchObject({
        enabled: true,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
      })
    }).pipe(Effect.scoped),
  )
})

test("catalog projects Kilo disclosures and variants without replacing configured variants", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "fixture",
        name: "Fixture from Kilo",
        context_length: 128000,
        supported_parameters: ["tools"],
        hasUserByokAvailable: true,
        mayTrainOnYourPrompts: false,
        opencode: {
          family: "fixture",
          variants: {
            low: { reasoningEffort: "low" },
            variant: { reasoningEffort: "must-not-replace-configured-variant" },
          },
          prompt: "codex",
          ai_sdk_provider: "openai-compatible",
        },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      const model = host.state.record.models.get("fixture")!
      expect(model.name).toBe("Fixture from Kilo")
      expect(model.variants.find((item) => item.id === "low")?.settings).toMatchObject({ reasoningEffort: "low" })
      expect(model.variants.find((item) => item.id === "variant")?.settings).not.toHaveProperty("reasoningEffort")
      expect(yield* host.models().list({}, call())).toEqual([
        { id: "fixture", hasUserByokAvailable: true, mayTrainOnYourPrompts: false },
      ])
    }).pipe(Effect.scoped),
  )
})

test("catalog dispatches each Gateway model through its declared native protocol", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "anthropic",
        name: "Anthropic",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "anthropic" },
      },
      {
        id: "openai",
        name: "OpenAI",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "openai" },
      },
      {
        id: "compatible",
        name: "Compatible",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "openai-compatible" },
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "openrouter" },
      },
      {
        id: "fallback",
        name: "Fallback",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "unsupported" },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      expect(host.state.record.models.get("anthropic")?.package).toBe("aisdk:@ai-sdk/anthropic")
      expect(host.state.record.models.get("openai")?.package).toBe("aisdk:@ai-sdk/openai")
      expect(host.state.record.models.get("compatible")?.package).toBe("aisdk:@ai-sdk/openai-compatible")
      expect(host.state.record.models.get("openrouter")?.package).toBe("aisdk:@openrouter/ai-sdk-provider")
      expect(host.state.record.models.get("fallback")?.package).toBe("aisdk:@openrouter/ai-sdk-provider")
    }).pipe(Effect.scoped),
  )
})

test("Gateway native Messages promotes Kilo key auth and Responses strips stateless item references", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      const messages = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/messages`, { method: "POST", headers: { "x-api-key": "private-key" } }),
      )
      expect(messages.headers.get("authorization")).toBe("Bearer private-key")
      expect(messages.headers.get("x-api-key")).toBe("private-key")

      // A configured or foreign Authorization header must not suppress the active Kilo key:
      // the key-derived Bearer wins, matching v1's unconditional override.
      const configured = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/messages`, {
          method: "POST",
          headers: { authorization: "Bearer bogus-configured", "x-api-key": "private-key" },
        }),
      )
      expect(configured.headers.get("authorization")).toBe("Bearer private-key")

      // A real OAuth Bearer (native authToken flow) carries no x-api-key and is preserved.
      const oauth = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/messages`, {
          method: "POST",
          headers: { authorization: "Bearer oauth-token" },
        }),
      )
      expect(oauth.headers.get("authorization")).toBe("Bearer oauth-token")

      const chat = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/chat/completions`, { headers: { "x-api-key": "private-key" } }),
      )
      expect(chat.headers.get("authorization")).toBeNull()

      const getMessages = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/messages`, { headers: { "x-api-key": "private-key" } }),
      )
      expect(getMessages.headers.get("authorization")).toBeNull()

      const responses = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "999" },
          body: JSON.stringify({
            store: false,
            input: [
              { type: "item_reference", id: "ref_1" },
              { type: "reasoning", id: "rs_1", encrypted_content: "opaque-state" },
              { type: "message", id: "msg_1", content: "continue" },
              "plain input",
            ],
          }),
        }),
      )
      expect(responses.headers.get("content-length")).toBeNull()
      expect(yield* Effect.promise(() => responses.json())).toEqual({
        store: false,
        input: [
          { type: "reasoning", encrypted_content: "opaque-state" },
          { type: "message", content: "continue" },
          "plain input",
        ],
      })

      const stored = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ store: true, input: [{ type: "item_reference", id: "ref_1" }] }),
        }),
      )
      expect(yield* Effect.promise(() => stored.json())).toEqual({
        store: true,
        input: [{ type: "item_reference", id: "ref_1" }],
      })

      // A stored conversation is not a credential-hygiene exemption: reserved account fields are
      // stripped even when item references must survive for server-side conversation state.
      const storedAccount = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            store: true,
            server: backend.url,
            email: "account@example.test",
            input: [{ type: "item_reference", id: "ref_1" }],
          }),
        }),
      )
      expect(yield* Effect.promise(() => storedAccount.json())).toEqual({
        store: true,
        input: [{ type: "item_reference", id: "ref_1" }],
      })

      // Stateless calls strip reserved account fields alongside item references, preserving
      // encrypted reasoning.
      const statelessAccount = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            store: false,
            organizationID: "selected",
            token: "token-value",
            input: [
              { type: "item_reference", id: "ref_1" },
              { type: "reasoning", id: "rs_1", encrypted_content: "opaque-state" },
            ],
          }),
        }),
      )
      expect(yield* Effect.promise(() => statelessAccount.json())).toEqual({
        store: false,
        input: [{ type: "reasoning", encrypted_content: "opaque-state" }],
      })

      const unreferenced = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "999" },
          body: JSON.stringify({ store: false, input: [{ type: "message", content: "first request" }] }),
        }),
      )
      expect(unreferenced.headers.get("content-length")).toBe("999")
      expect(yield* Effect.promise(() => unreferenced.json())).toEqual({
        store: false,
        input: [{ type: "message", content: "first request" }],
      })

      const nonJSON = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/responses`, { method: "POST", body: "not json" }),
      )
      expect(yield* Effect.promise(() => nonJSON.text())).toBe("not json")

      const foreign = yield* host.httpRequest(
        new Request("https://foreign.example/api/gateway/responses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ store: false, input: [{ type: "item_reference", id: "ref_1" }] }),
        }),
      )
      expect(yield* Effect.promise(() => foreign.json())).toEqual({
        store: false,
        input: [{ type: "item_reference", id: "ref_1" }],
      })

      // Account/credential fields merged into model settings by Core's resolver must never leave
      // the host in a Gateway request body. Top-level reserved keys are stripped; nested
      // provider routing, BYOK payloads, reasoning, and user content stay untouched.
      const account = {
        server: backend.url,
        organizationID: "selected",
        organizationName: "Selected Org",
        email: "account@example.test",
        name: "Account Holder",
        organizations: [{ id: "selected" }],
        selectedOrganizationId: "selected",
        hasPersonalAccount: true,
        user: { email: "account@example.test" },
        token: "token-value",
        access: "access-value",
        refresh: "refresh-value",
      }
      for (const endpoint of ["/messages", "/chat/completions"] as const) {
        const stripped = yield* host.httpRequest(
          new Request(`${backend.url}/api/gateway${endpoint}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": "private-key" },
            body: JSON.stringify({
              ...account,
              model: "fixture",
              provider: { order: ["together"] },
              models: ["fixture"],
              reasoning: { effort: "high" },
              messages: [{ role: "user", content: "name and email stay in content" }],
              metadata: { user_id: "nested-preserved" },
              api_keys: { together: "byok-stays" },
            }),
          }),
        )
        // Bearer promotion is Messages-only; the chat dialect carries no x-api-key promotion.
        expect(stripped.headers.get("authorization")).toBe(endpoint === "/messages" ? "Bearer private-key" : null)
        const strippedBody = (yield* Effect.promise(() => stripped.json())) as Record<string, unknown>
        for (const key of Object.keys(account)) {
          expect(strippedBody).not.toHaveProperty(key)
        }
        expect(strippedBody).toMatchObject({
          model: "fixture",
          provider: { order: ["together"] },
          models: ["fixture"],
          reasoning: { effort: "high" },
          metadata: { user_id: "nested-preserved" },
          api_keys: { together: "byok-stays" },
        })
        expect(strippedBody.messages).toEqual([{ role: "user", content: "name and email stay in content" }])
      }

      // Bodies without reserved keys are left byte-identical, and foreign origins are never read.
      const cleanBody = JSON.stringify({ model: "fixture", messages: [] })
      const clean = yield* host.httpRequest(
        new Request(`${backend.url}/api/gateway/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: cleanBody,
        }),
      )
      expect(yield* Effect.promise(() => clean.text())).toBe(cleanBody)
      const foreignChat = yield* host.httpRequest(
        new Request("https://foreign.example/api/gateway/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ server: "untouched", token: "untouched" }),
        }),
      )
      expect(yield* Effect.promise(() => foreignChat.json())).toEqual({ server: "untouched", token: "untouched" })
    }).pipe(Effect.scoped),
  )
})

test("API catalog enriches defaults but preserves explicitly configured model fields across refresh", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "fixture",
        name: "API Fixture",
        context_length: 64000,
        max_completion_tokens: 8000,
        pricing: { prompt: "0.000001", completion: "0.000002" },
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["tools"],
      },
      {
        id: "api-only",
        name: "API Only",
        context_length: 32000,
        max_completion_tokens: 4000,
        pricing: { prompt: "0.000003", completion: "0.000004" },
        supported_parameters: ["tools"],
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      // The host config fold runs before the Gateway transform, so the seeded model already
      // carries the configured name and merged limit; configEntries supplies the same documents
      // for explicit-field provenance.
      const host = yield* harness({
        fixtureModel: { name: "Configured Fixture", limit: { context: 1024, output: 32000 } },
      })
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      const entries = {
        current: [
          new Document({
            type: "document",
            info: new Info({
              providers: {
                kilo: new ConfigProvider.Info({
                  models: {
                    fixture: { name: "Configured Fixture", limit: { context: 1024 } },
                  },
                }),
              },
            }),
          }),
        ] as Config.Entry[],
      }
      yield* registerGateway(host.ctx, {
        server: backend.url,
        configEntries: () => Effect.succeed(entries.current),
      })

      // Explicit configured name and limit.context survive; unconfigured fields take API values.
      const fixtureModel = host.state.record.models.get("fixture")!
      expect(fixtureModel.name).toBe("Configured Fixture")
      expect(fixtureModel.limit.context).toBe(1024)
      expect(fixtureModel.limit.output).toBe(8000)
      expect(fixtureModel.cost).toEqual([cost(1, 2)])
      expect(fixtureModel.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })

      // API-only models are fully enriched.
      const apiOnly = host.state.record.models.get("api-only")!
      expect(apiOnly.name).toBe("API Only")
      expect(apiOnly.limit).toEqual({ context: 32000, output: 4000 })
      expect(apiOnly.cost).toEqual([cost(3, 4)])
      expect(apiOnly.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })

      // Account refresh replaces non-explicit values without retaining stale account data;
      // explicit configured fields still win.
      backend.state.models = {
        data: [
          {
            id: "fixture",
            name: "API Fixture Renamed",
            context_length: 128000,
            max_completion_tokens: 16000,
            pricing: { prompt: "0.000005", completion: "0.000006" },
            supported_parameters: ["tools"],
          },
        ],
      }
      yield* host.notify()
      const refreshed = host.state.record.models.get("fixture")!
      expect(refreshed.name).toBe("Configured Fixture")
      expect(refreshed.limit.context).toBe(1024)
      expect(refreshed.limit.output).toBe(16000)
      expect(refreshed.cost).toEqual([cost(5, 6)])
      expect(refreshed.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
      expect(host.state.record.models.has("api-only")).toBe(false)

      // A config update re-reads entries: newly explicit cost now wins over the API value.
      entries.current = [
        new Document({
          type: "document",
          info: new Info({
            providers: {
              kilo: new ConfigProvider.Info({
                models: {
                  fixture: {
                    name: "Configured Fixture",
                    limit: { context: 1024 },
                    cost: { input: Money.USDPerMillionTokens.make(7), output: Money.USDPerMillionTokens.make(8) },
                  },
                },
              }),
            },
          }),
        }),
      ]
      // The host fold would place the configured cost onto the rebuilt model before the
      // Gateway transform runs; update the base seed the same way.
      host.state.seed = {
        ...host.state.seed,
        models: new Map([
          [
            "fixture",
            {
              ...host.state.seed.models.get("fixture")!,
              cost: [cost(7, 8)],
            },
          ],
        ]),
      }
      yield* host.notifyConfig()
      const updated = host.state.record.models.get("fixture")!
      expect(updated.cost).toEqual([cost(7, 8)])
      expect(updated.name).toBe("Configured Fixture")
      expect(updated.limit.output).toBe(16000)
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  )
})

test("explicit model package configuration wins over Gateway protocol metadata", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "fixture",
        name: "Fixture",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "anthropic" },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness({ configuredModelPackage: "aisdk:@ai-sdk/openai-compatible" })
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      expect(host.state.record.models.get("fixture")?.package).toBe("aisdk:@ai-sdk/openai-compatible")
    }).pipe(Effect.scoped),
  )
})

test("team catalog refresh replaces stale protocol metadata with the OpenRouter fallback", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "fixture",
        name: "Fixture",
        context_length: 128000,
        supported_parameters: ["tools"],
        opencode: { ai_sdk_provider: "anthropic" },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      expect(host.state.record.models.get("fixture")?.package).toBe("aisdk:@ai-sdk/anthropic")

      backend.state.models = {
        data: [
          {
            id: "fixture",
            name: "Fixture",
            context_length: 128000,
            supported_parameters: ["tools"],
            opencode: { ai_sdk_provider: "unsupported" },
          },
        ],
      }
      yield* host.notify()

      expect(host.state.record.models.get("fixture")?.package).toBe("aisdk:@openrouter/ai-sdk-provider")
    }).pipe(Effect.scoped),
  )
})

test("catalog requires the Gateway name and context fields", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [{ id: "incomplete", name: "Incomplete", context_length: 0, supported_parameters: ["tools"] }],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      expect(host.state.record.models.has("incomplete")).toBe(false)
      expect(host.state.record.models.get("fixture")?.enabled).toBe(false)
    }).pipe(Effect.scoped),
  )
})

test("catalog rejects overflowing and malformed OpenRouter prices", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "price-overflow",
        name: "Price Overflow",
        context_length: 128000,
        supported_parameters: ["tools"],
        pricing: { prompt: "1e308", completion: "0" },
      },
      {
        id: "price-suffix",
        name: "Price Suffix",
        context_length: 128000,
        supported_parameters: ["tools"],
        pricing: { prompt: "0.1 USD", completion: "0" },
      },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })

      expect(host.state.record.models.get("price-overflow")?.cost).toEqual([])
      expect(host.state.record.models.get("price-suffix")?.cost).toEqual([])
    }).pipe(Effect.scoped),
  )
})

test("scoped Gateway catalog creates API-only Auto models and never reuses a failed team snapshot", async () => {
  using backend = fixture()
  backend.state.models = {
    data: [
      {
        id: "kilo-auto/free",
        name: "Kilo Auto Free",
        context_length: 128000,
        max_completion_tokens: 16000,
        preferredIndex: 1,
        supported_parameters: ["tools"],
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        pricing: { prompt: "0", completion: "0", input_cache_read: "0", input_cache_write: "0" },
      },
      { id: "unsupported", name: "Unsupported", context_length: 1000, supported_parameters: ["temperature"] },
    ],
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      const auto = host.state.record.models.get("kilo-auto/free")
      expect(auto).toMatchObject({
        name: "Kilo Auto Free",
        enabled: true,
        limit: { context: 128000, output: 16000 },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      })
      expect(Number(auto?.cost[0]?.input)).toBe(0)
      expect(Number(auto?.cost[0]?.output)).toBe(0)
      expect(auto?.cost[0]?.cache).toMatchObject({ read: 0, write: 0 })
      expect(host.state.record.models.get("fixture")?.enabled).toBe(false)
      expect(host.state.record.models.has("unsupported")).toBe(false)
      expect(backend.requests.at(-1)).toMatchObject({
        path: "/api/organizations/selected/models",
        authorization: "Bearer private-key",
        organizationID: "selected",
      })

      backend.state.modelsStatus = 503
      yield* host.notify()
      expect(host.state.record.models.has("kilo-auto/free")).toBe(false)
      expect(host.state.record.models.get("fixture")?.enabled).toBe(false)

      yield* host.rpc()["organization.set"]({ organizationID: null }, call())
      expect(host.state.record.models.get("fixture")?.enabled).toBe(true)
      expect(backend.requests.at(-1)).toMatchObject({ path: "/api/openrouter/models", organizationID: null })
    }).pipe(Effect.scoped),
  )
})

test("stale persisted organization selections fail closed without routing the removed organization", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.OAuth.make({
        type: "oauth",
        methodID: IntegrationMethodID.make("device"),
        access: "fixture-token",
        refresh: "fixture-token",
        expires: 0,
        metadata: { server: backend.url },
      })
      host.storage.set(`organization:${host.connectionID}`, { organizationID: "removed" })
      yield* registerGateway(host.ctx, { server: backend.url })
      expect(host.state.record.provider.activation).toBe("disabled")
      const model = host.state.record.models.get("fixture")!
      for (const item of [host.state.record.provider, model, ...model.variants]) {
        expect(item.headers).not.toHaveProperty("X-KILOCODE-ORGANIZATIONID")
        expect(item.headers).not.toHaveProperty("x-kilocode-organizationid")
      }
      expect(yield* host.rpc().profile({}, call())).toMatchObject({
        currentOrganizationID: "removed",
        selectionAvailable: false,
      })
    }).pipe(Effect.scoped),
  )
})

test("RPC rejects OAuth credentials from unregistered Kilo sign-in methods", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.OAuth.make({
        type: "oauth",
        methodID: IntegrationMethodID.make("unsupported"),
        access: "must-not-be-sent",
        refresh: "must-not-be-sent",
        expires: 0,
        metadata: { server: backend.url },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      const result = yield* host
        .rpc()
        .profile({}, call())
        .pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Left", left: error }),
            onSuccess: (value) => ({ _tag: "Right", right: value }),
          }),
        )
      expect(result).toMatchObject({
        _tag: "Left",
        left: {
          type: "kilocode.gateway",
          message: "The active Kilo credential uses an unsupported sign-in method",
        },
      })
      expect(host.state.record.provider.activation).toBe("disabled")
      expect(backend.requests).toEqual([])
    }).pipe(Effect.scoped),
  )
})

test("RPC rejects unavailable accounts and reports profile transport failures with canonical errors", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      yield* registerGateway(host.ctx, { server: backend.url })
      const handlers = host.rpc()
      const missing = yield* handlers.profile({}, call()).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Left", left: error }),
          onSuccess: (value) => ({ _tag: "Right", right: value }),
        }),
      )
      expect(missing).toMatchObject({
        _tag: "Left",
        left: { type: "kilocode.gateway", message: "Sign in with Kilo before selecting an account" },
      })
      expect(backend.requests).toEqual([])
      host.state.credential = Credential.Key.make({
        type: "key",
        key: "private-key",
        metadata: { server: backend.url },
      })
      const unknown = yield* handlers["organization.set"]({ organizationID: "missing" }, call()).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Left", left: error }),
          onSuccess: (value) => ({ _tag: "Right", right: value }),
        }),
      )
      expect(unknown).toMatchObject({
        _tag: "Left",
        left: { type: "kilocode.gateway", message: "The selected Kilo organization is not available" },
      })
      backend.state.profile = { organizations: [{ id: "first", name: "First" }], hasPersonalAccount: false }
      const personal = yield* handlers["organization.set"]({ organizationID: null }, call()).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Left", left: error }),
          onSuccess: (value) => ({ _tag: "Right", right: value }),
        }),
      )
      expect(personal).toMatchObject({
        _tag: "Left",
        left: { type: "kilocode.gateway", message: "This Kilo account has no personal account" },
      })
      backend.state.profileStatus = 500
      const unavailable = yield* host
        .rpc()
        .profile({}, call())
        .pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Left", left: error }),
            onSuccess: (value) => ({ _tag: "Right", right: value }),
          }),
        )
      expect(unavailable).toMatchObject({
        _tag: "Left",
        left: { type: "kilocode.gateway_unavailable", message: "Unable to retrieve the Kilo profile" },
      })
      expect(host.storage.size).toBe(0)
    }).pipe(Effect.scoped),
  )
})

test("RPC restores the previous selection when catalog synchronization fails", async () => {
  using backend = fixture()
  await Effect.runPromise(
    Effect.gen(function* () {
      const host = yield* harness()
      host.state.credential = Credential.OAuth.make({
        type: "oauth",
        methodID: IntegrationMethodID.make("device"),
        access: "fixture-token",
        refresh: "fixture-token",
        expires: 0,
        metadata: { server: backend.url, organizationID: "selected" },
      })
      yield* registerGateway(host.ctx, { server: backend.url })
      host.state.reloadFailures = 1
      const handlers = host.rpc()
      const result = yield* handlers["organization.set"]({ organizationID: "first" }, call()).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Left", left: error }),
          onSuccess: (value) => ({ _tag: "Right", right: value }),
        }),
      )
      expect(result).toMatchObject({
        _tag: "Left",
        left: {
          type: "kilocode.gateway_unavailable",
          message: "Kilo account change failed; the previous selection was restored",
        },
      })
      expect(host.storage.size).toBe(0)
      expect((yield* host.rpc().profile({}, call())).currentOrganizationID).toBe("selected")
    }).pipe(Effect.scoped),
  )
})
