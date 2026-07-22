import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "@/provider/provider"
import { InstanceLayer } from "@/project/instance-layer"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer, Plugin.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

it.effect("loads Snowflake Cortex from OAuth credentials", () =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const value = process.env.KILO_AUTH_CONTENT
      process.env.KILO_AUTH_CONTENT = JSON.stringify({
        "snowflake-cortex": {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 1,
          accountId: "test-account",
        },
      })
      return value
    }),
    (value) =>
      Effect.sync(() => {
        if (value === undefined) delete process.env.KILO_AUTH_CONTENT
        else process.env.KILO_AUTH_CONTENT = value
      }),
  ).pipe(
    Effect.flatMap(() =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({
          config: {
            provider: {
              "snowflake-cortex": {
                name: "Snowflake Cortex",
                npm: "@ai-sdk/openai-compatible",
                models: { test: { name: "Test" } },
              },
            },
          },
        })
        const provider = yield* Provider.use
          .getProvider(ProviderV2.ID.make("snowflake-cortex"))
          .pipe(provideInstanceEffect(directory), Effect.provide(InstanceLayer.layer))

        expect(provider.options.baseURL).toBe("https://test-account.snowflakecomputing.com/api/v2/cortex/v1")
        expect(provider.options.apiKey).toBe("access-token")
        expect(provider.options.fetch).toBeFunction()
      }),
    ),
  ),
)
