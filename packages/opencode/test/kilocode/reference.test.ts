import { describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import * as Reference from "../../src/kilocode/reference"
import { Reference as CoreReference } from "@opencode-ai/core/reference"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Config } from "../../src/config/config"
import { locations } from "../../src/kilocode/server/reference-reconciler"
import { testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

function remote() {
  const item = Reference.resolveAll({
    references: { docs: "Kilo-Org/kilocode" },
    directory: "/workspace",
    worktree: "/workspace",
  })[0]
  if (!item || item.kind !== "git") throw new Error("expected Git reference")
  return item
}

describe("configured references", () => {
  test("preserves interruption while materializing a repository", async () => {
    const cache = RepositoryCache.Service.of({ ensure: () => Effect.interrupt })
    const exit = await Effect.runPromiseExit(Reference.ensure(cache, remote()))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  })

  test("sync preserves effective reference metadata", async () => {
    const cache = Layer.mock(RepositoryCache.Service, {
      ensure: () => Effect.die("unexpected Git materialization"),
    })
    const events = Layer.mock(EventV2.Service)({
      publish: (definition, data) =>
        Effect.succeed({ id: EventV2.ID.make("evt_reference_sync"), type: definition.type, data }),
    })
    const layer = CoreReference.layer.pipe(
      Layer.provide(cache),
      Layer.provide(events),
      Layer.provide(Global.defaultLayer),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Reference.sync({
          references: {
            docs: {
              path: "./docs",
              description: "Internal documentation",
              hidden: true,
            },
          },
          directory: "/workspace/src",
          worktree: "/workspace",
        })
        return yield* (yield* CoreReference.Service).list()
      }).pipe(Effect.provide(layer), Effect.scoped),
    )

    expect(result).toEqual([
      expect.objectContaining({
        name: "docs",
        path: path.resolve("/workspace", "docs"),
        description: "Internal documentation",
        hidden: true,
        source: expect.objectContaining({ description: "Internal documentation", hidden: true }),
      }),
    ])
  })

  test("sync does not publish an update for equivalent references", async () => {
    const cache = Layer.mock(RepositoryCache.Service, {
      ensure: () => Effect.die("unexpected Git materialization"),
    })
    const updates: string[] = []
    const events = Layer.mock(EventV2.Service)({
      publish: (definition, data) => {
        updates.push(definition.type)
        return Effect.succeed({ id: EventV2.ID.make(`evt_${updates.length}`), type: definition.type, data })
      },
    })
    const layer = CoreReference.layer.pipe(
      Layer.provide(cache),
      Layer.provide(events),
      Layer.provide(Global.defaultLayer),
    )
    const input = {
      references: { docs: { path: "./docs", description: "Internal documentation", hidden: true } },
      directory: "/workspace/src",
      worktree: "/workspace",
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Reference.sync(input)
        yield* Reference.sync(input)
      }).pipe(Effect.provide(layer), Effect.scoped),
    )

    expect(updates).toEqual(["reference.updated"])
  })

  test("initializes effective references before exposing location services", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        references: {
          docs: { path: "./docs", description: "Internal documentation" },
        },
      },
    })
    const layer = locations.pipe(Layer.provide(Config.defaultLayer), Layer.provide(testInstanceStoreLayer))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const map = yield* LocationServiceMap
        return yield* CoreReference.Service.use((reference) => reference.list()).pipe(
          Effect.provide(map.get(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))),
        )
      }).pipe(Effect.provide(layer), Effect.scoped),
    )

    expect(result).toEqual([
      expect.objectContaining({
        name: "docs",
        path: path.join(tmp.path, "docs"),
        description: "Internal documentation",
      }),
    ])
  }, 15_000)
})
