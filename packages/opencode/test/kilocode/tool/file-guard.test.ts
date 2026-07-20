import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "../../../src/effect/instance-state"
import { KiloFileGuard } from "../../../src/kilocode/tool/file-guard"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

describe("KiloFileGuard", () => {
  it.live("rejects a target replaced after authorization", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const filepath = path.join(dir, "target.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "before"))
        const plan = yield* KiloFileGuard.plan({ ctx, requested: filepath })

        yield* Effect.promise(async () => {
          await fs.rm(filepath)
          await fs.writeFile(filepath, "after")
        })

        const exit = yield* KiloFileGuard.revalidate({ ctx, plan }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(KiloFileGuard.ChangedError)
      }),
    ),
  )
})
