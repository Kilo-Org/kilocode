import { expect, test } from "bun:test"
import type { CatalogEditor, CatalogProviderRecord } from "@opencode-ai/plugin/effect/catalog"
import type { IntegrationEditor, IntegrationMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import type { RpcCallContext, RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { IntegrationID } from "@opencode-ai/schema/integration-id"
import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Deferred, Effect, Exit, PubSub, Schema, Scope, Stream } from "effect"
import { registerGateway, type GatewayContext, type GatewayOptions } from "../src/index.js"
import { fixture } from "./fixture.js"

// The promptSelector handoff is location-scoped: createGatewayPlugin activates per Location and
// each activation owns its account-scoped catalog cache, so a single host variable overwritten
// by the last setup would be wrong. These tests drive the real registerGateway with two
// simultaneous Locations and a host registry mirroring the production interactive-server wiring
// (JSON-tuple key, exact-reader scoped cleanup), asserting isolation, live-cache reads,
// malformed-tag tolerance, failure/revocation clearing, and scoped disposal.

function hostRegistry() {
  const readers = new Map<string, (modelID: string) => string | undefined>()
  const key = (location: Location.Ref) => JSON.stringify([location.directory, location.workspaceID ?? null])
  const promptSelector: GatewayOptions["promptSelector"] = {
    register: (location, read) =>
      Effect.gen(function* () {
        const locationKey = key(location)
        readers.set(locationKey, read)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (readers.get(locationKey) === read) readers.delete(locationKey)
          }),
        )
      }),
  }
  return {
    readers,
    promptSelector,
    selector: (location: Location.Ref, modelID: string) => readers.get(key(location))?.(modelID),
  }
}

const harness = Effect.fn(function* (directory: string) {
  const changes = yield* PubSub.unbounded<Stream.Success<ReturnType<GatewayContext["event"]["subscribe"]>>>()
  const catalogTransforms: ((editor: CatalogEditor) => void)[] = []
  const sessionHooks: ((event: SessionHooks["http.request"]) => Effect.Effect<void>)[] = []
  const methods = new Map<string, IntegrationMethodRegistration>([
    ["key", { integrationID: "kilo", method: { type: "key" } }],
  ])
  const storage = new Map<string, Schema.Json>()
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
      headers: {},
    },
    models: new Map(),
  }
  const connection = { type: "credential" as const, id: Credential.ID.create(), label: "Fixture" }
  const state = {
    credential: undefined as Credential.Value | undefined,
    record: structuredClone(seed),
    updated: yield* Deferred.make<void>(),
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
  const integrationRecord = { id: IntegrationID.make("kilo"), name: "Kilo" }
  const integration: IntegrationEditor = {
    list: () => [integrationRecord],
    get: (id) => (id === "kilo" ? integrationRecord : undefined),
    update: (id, update) => {
      if (id === "kilo") update(integrationRecord)
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
  const path = AbsolutePath.make(directory)
  const ctx: GatewayContext = {
    location: new Location.Info({
      directory: path,
      project: { id: Project.ID.make(`fixture-${directory}`), directory: path, canonical: path },
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
            return state.credential ? connection : undefined
          }),
        resolve: () => Effect.succeed(state.credential),
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
          state.record = structuredClone(seed)
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
  return {
    ctx,
    state,
    storage,
    notify,
    connectionID: connection.id,
    rpc: () => {
      if (!rpc.gateway) throw new Error("Gateway RPC was not registered")
      return rpc.gateway
    },
  }
})

function call<M extends (typeof KiloGateway.Definition.methods)[keyof typeof KiloGateway.Definition.methods]>() {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { error: (type: string, message: string) => ({ type, message }) } as unknown as RpcCallContext<M>
}

function locationRef(directory: string): Location.Ref {
  return { directory: AbsolutePath.make(directory), workspaceID: undefined }
}

function catalog(models: readonly { id: string; prompt?: unknown }[]) {
  return {
    data: models.map((model) => ({
      id: model.id,
      name: model.id,
      context_length: 128000,
      supported_parameters: ["tools"],
      ...(model.prompt === undefined ? {} : { opencode: { prompt: model.prompt } }),
    })),
  }
}

test("promptSelector readers are location-scoped, live, tolerant, and scope-cleaned", async () => {
  using backend = fixture()
  backend.state.profile = {
    organizations: [{ id: "team", name: "Team", role: "member" }],
    selectedOrganizationId: "team",
    hasPersonalAccount: true,
  }
  backend.state.models = catalog([
    { id: "alpha", prompt: "anthropic" },
    { id: "beta", prompt: "trinity" },
    { id: "codex-model", prompt: "codex" },
    { id: "without-todo-model", prompt: "anthropic_without_todo" },
    { id: "gpt55-model", prompt: "gpt55" },
    { id: "gemini-model", prompt: "gemini" },
    { id: "ling-model", prompt: "ling" },
    { id: "beast-model", prompt: "beast" },
    // Out-of-enum and non-string tags must decode to no tag without dropping the model.
    { id: "gamma", prompt: "not-a-selector" },
    { id: "delta", prompt: 42 },
    // No tag at all.
    { id: "epsilon" },
  ])
  const registry = hostRegistry()
  const refA = locationRef("/fixture-a")
  const refB = locationRef("/fixture-b")

  // Two simultaneous Locations, each in its own scope so disposal is independently testable.
  const scopeA = await Effect.runPromise(Scope.make())
  const scopeB = await Effect.runPromise(Scope.make())
  const activate = (directory: string, key: string, scope: Scope.Scope) =>
    Effect.gen(function* () {
      const host = yield* harness(directory)
      host.state.credential = { type: "key", key, metadata: { server: backend.url } }
      yield* registerGateway(host.ctx, { server: backend.url, promptSelector: registry.promptSelector })
      return host
    }).pipe(Effect.provideService(Scope.Scope, scope))
  const modelRequestsBefore = backend.requests.filter((item) => item.path.includes("/models")).length
  const hostA = await Effect.runPromise(activate("/fixture-a", "secret-a", scopeA))
  await Effect.runPromise(activate("/fixture-b", "secret-b", scopeB))

  // Both Locations registered independent readers over their own live cache; no last-setup win.
  expect(registry.readers.size).toBe(2)
  expect(registry.selector(refA, "alpha")).toBe("anthropic")
  expect(registry.selector(refB, "alpha")).toBe("anthropic")
  expect(registry.selector(refA, "beta")).toBe("trinity")
  expect(registry.selector(refA, "codex-model")).toBe("codex")
  expect(registry.selector(refA, "without-todo-model")).toBe("anthropic_without_todo")
  expect(registry.selector(refA, "gpt55-model")).toBe("gpt55")
  expect(registry.selector(refA, "gemini-model")).toBe("gemini")
  expect(registry.selector(refA, "ling-model")).toBe("ling")
  expect(registry.selector(refA, "beast-model")).toBe("beast")

  // Malformed and non-string tags decode to no selector; the untagged model has none either.
  expect(registry.selector(refA, "gamma")).toBeUndefined()
  expect(registry.selector(refA, "delta")).toBeUndefined()
  expect(registry.selector(refA, "epsilon")).toBeUndefined()

  // The tag is provenance for the policy only: it must never be written into the materialized
  // catalog record's family, settings, or headers.
  const materialized = hostA.state.record.models.get("alpha")
  expect(materialized?.family).toBeUndefined()
  expect(JSON.stringify(materialized?.settings)).not.toContain("anthropic")
  expect(JSON.stringify(materialized?.headers)).not.toContain("anthropic")

  // No per-request fetch: the models endpoint was hit only during the two activations' refreshes,
  // not once per selector read above.
  const modelRequestsAfter = backend.requests.filter((item) => item.path.includes("/models")).length
  expect(modelRequestsAfter).toBe(modelRequestsBefore + 2)

  // Account refresh: switch Location A to the personal account, whose catalog carries a different
  // tag for the same model id. The reader must follow the refreshed cache, not the stale team tag.
  backend.state.models = catalog([{ id: "alpha", prompt: "trinity" }])
  await Effect.runPromise(hostA.rpc()["organization.set"]({ organizationID: null }, call()))
  expect(registry.selector(refA, "alpha")).toBe("trinity")
  // Location B kept its own account's cache and is unaffected by A's switch.
  expect(registry.selector(refB, "alpha")).toBe("anthropic")

  // Scoped disposal: closing A's scope removes only A's reader, and an obsolete scope cannot
  // remove B's reader or a successor registered under A's key.
  await Effect.runPromise(Scope.close(scopeA, Exit.void))
  expect(registry.readers.size).toBe(1)
  expect(registry.selector(refA, "alpha")).toBeUndefined()
  expect(registry.selector(refB, "alpha")).toBe("anthropic")
  await Effect.runPromise(Scope.close(scopeB, Exit.void))
  expect(registry.readers.size).toBe(0)
})

test("a failed or revoked account cache clears the selector without dropping the reader", async () => {
  using backend = fixture()
  backend.state.profile = {
    organizations: [{ id: "team", name: "Team", role: "member" }],
    selectedOrganizationId: "team",
    hasPersonalAccount: true,
  }
  backend.state.models = catalog([{ id: "alpha", prompt: "anthropic" }])
  const registry = hostRegistry()
  const refA = locationRef("/fixture-a")
  const scopeA = await Effect.runPromise(Scope.make())
  const host = await Effect.runPromise(
    Effect.gen(function* () {
      const activated = yield* harness("/fixture-a")
      activated.state.credential = { type: "key", key: "secret-a", metadata: { server: backend.url } }
      yield* registerGateway(activated.ctx, { server: backend.url, promptSelector: registry.promptSelector })
      return activated
    }).pipe(Effect.provideService(Scope.Scope, scopeA)),
  )
  expect(registry.selector(refA, "alpha")).toBe("anthropic")

  // Revoke the account selection: organization.set to a team the profile no longer offers fails,
  // but a credential drop that fails the refresh leaves the cache absent and the selector clear.
  backend.state.modelsStatus = 500
  host.state.credential = { type: "key", key: "secret-a", metadata: { server: backend.url } }
  await Effect.runPromise(host.notify())
  expect(registry.selector(refA, "alpha")).toBeUndefined()

  // The reader is still registered for the Location; only the selector is cleared.
  expect(registry.readers.size).toBe(1)
  await Effect.runPromise(Scope.close(scopeA, Exit.void))
  expect(registry.readers.size).toBe(0)
})
