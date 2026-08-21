// kilocode_change - new file
// Reproduces the reported symptom end to end through ModelsDev.get(), the caller that actually
// builds the kilo fetch options: a client started before login (TUI) fetched the public catalog,
// and for the rest of the 5 minute TTL every later authenticated fetch was served that same public
// catalog — so the TUI kept a short model list while a VS Code window started with a token saw the
// full one. Covers both a personal login and an organization login.

import { expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as CoreModels from "@opencode-ai/core/models-dev"
import { Effect, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider/models"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const model = (id: string) => ({
  id,
  name: id,
  cost: { input: 1, output: 2 },
  limit: { context: 200000, output: 8192 },
})

const PUBLIC_CATALOG = { "anthropic/claude-sonnet-4": model("anthropic/claude-sonnet-4") }
const FULL_CATALOG = {
  ...PUBLIC_CATALOG,
  "anthropic/claude-sonnet-4.5": model("anthropic/claude-sonnet-4.5"),
}

const seed: Record<string, ModelsDev.Provider> = {
  apertis: { id: "apertis", name: "Apertis", env: ["APERTIS_API_KEY"], models: {} },
}

const files = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({ ...fs, readJson: () => Effect.succeed(seed), stat: () => fs.stat(import.meta.path) })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

// The gateway serves the public catalog to an anonymous request and the full one to an authenticated
// request — the same shape as the 401 fallback in @kilocode/kilo-gateway.
function layer(info: Ref.Ref<Auth.Info | undefined>) {
  const cfg = TestConfig.layer()
  const auth = Layer.mock(Auth.Service)({ get: (id) => (id === "kilo" ? Ref.get(info) : Effect.succeed(undefined)) })
  const models = Layer.succeed(
    ModelCache.KiloModelsService,
    ModelCache.KiloModelsService.of({
      fetch: (options) => Effect.succeed({ models: options.kilocodeToken ? FULL_CATALOG : PUBLIC_CATALOG }),
    }),
  )
  const cache = Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(cfg),
    Layer.provide(auth),
    Layer.provide(models),
  )
  const core = Layer.succeed(
    CoreModels.Service,
    CoreModels.Service.of({ get: () => Effect.succeed(seed), refresh: () => Effect.void }),
  )
  return Layer.fresh(ModelsDev.layer).pipe(
    Layer.provide(core),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(files),
    Layer.provide(cfg),
    Layer.provide(auth),
    Layer.provide(cache),
  )
}

const login = (accountId?: string) =>
  new Auth.Oauth({
    type: "oauth",
    access: "kilo-access-token",
    refresh: "kilo-refresh-token",
    expires: Date.now() + 3600000,
    ...(accountId ? { accountId } : {}),
  })

// Both catalog reads go through one long-lived ModelsDev/ModelCache pair, the way a single
// running client does — the stale entry lives in the cache service closure.
const session = (info: Ref.Ref<Auth.Info | undefined>, accountId?: string) =>
  Effect.gen(function* () {
    const models = yield* ModelsDev.Service
    const catalog = () => models.get().pipe(Effect.map((providers) => Object.keys(providers.kilo?.models ?? {}).sort()))

    const before = yield* catalog()
    yield* Ref.set(info, login(accountId))
    return { before, after: yield* catalog() }
  }).pipe(Effect.provide(layer(info)), provideInstance(process.cwd()))

const it = testEffect(testInstanceStoreLayer)

it.live("a personal login inside the TTL is not served the pre-login public catalog", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(undefined)
    const out = yield* session(info)

    expect(out.before).toEqual(["anthropic/claude-sonnet-4"])
    expect(out.after).toEqual(["anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4.5"])
  }),
)

it.live("an organization login inside the TTL is not served the pre-login public catalog", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(undefined)
    const out = yield* session(info, "org-enterprise-123")

    expect(out.before).toEqual(["anthropic/claude-sonnet-4"])
    expect(out.after).toEqual(["anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4.5"])
  }),
)
