import { describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import * as Reference from "../../src/kilocode/reference"
import { Reference as CoreReference } from "@opencode-ai/core/reference"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"

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
})
