// kilocode_change - new file
// ModelCache.options resolves the credentials, organization and gateway URL that
// Kilo catalog requests (models and endpoints alike) use: config kilo.json
// settings win over the stored session for organization and base URL.

import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

function layer(info: Auth.Info | undefined, config: Record<string, unknown> = {}) {
  const auth = Layer.mock(Auth.Service)({
    get: (id) => Effect.succeed(id === "kilo" ? info : undefined),
  })
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(TestConfig.layer({ get: () => Effect.succeed(config) })),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

const oauth = new Auth.Oauth({
  type: "oauth",
  access: "session-token",
  refresh: "refresh-token",
  expires: Date.now() + 3600000,
  accountId: "org-session",
})

const it = testEffect(Layer.empty)

it.live("resolves the stored session token and organization", () =>
  Effect.gen(function* () {
    const options = yield* ModelCache.Service.use((cache) => cache.options("kilo")).pipe(Effect.provide(layer(oauth)))
    expect(options).toEqual({ kilocodeToken: "session-token", kilocodeOrganizationId: "org-session" })
  }),
)

it.live("config base URL and organization win over the stored session", () =>
  Effect.gen(function* () {
    const config = {
      provider: {
        kilo: { options: { baseURL: "https://gateway.example.com", kilocodeOrganizationId: "org-config" } },
      },
    }
    const options = yield* ModelCache.Service.use((cache) => cache.options("kilo")).pipe(
      Effect.provide(layer(oauth, config)),
    )
    expect(options).toEqual({
      kilocodeToken: "session-token",
      kilocodeOrganizationId: "org-config",
      baseURL: "https://gateway.example.com",
    })
  }),
)

it.live("config-only credentials are used without a stored session", () =>
  Effect.gen(function* () {
    const config = { provider: { kilo: { options: { apiKey: "config-key" } } } }
    const options = yield* ModelCache.Service.use((cache) => cache.options("kilo")).pipe(
      Effect.provide(layer(undefined, config)),
    )
    expect(options).toEqual({ kilocodeToken: "config-key" })
  }),
)

it.live("other providers only get their stored credentials", () =>
  Effect.gen(function* () {
    const options = yield* ModelCache.Service.use((cache) => cache.options("openrouter")).pipe(
      Effect.provide(layer(oauth)),
    )
    expect(options).toEqual({})
  }),
)
