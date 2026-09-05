import { $ } from "bun"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Instance } from "@opencode-ai/core/instance/service"
import type { Services } from "@opencode-ai/core/instance/service"
import { Location } from "@opencode-ai/core/location"
import { Session } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/util/global"
import { Effect, Layer } from "effect"
import { createMemoryDiffReader } from "../src/memory-diff"

test("reads structured capture diffs from the session Location scope", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo2-memory-diff-test-")))
  try {
    const project = path.join(root, "project")
    await fs.mkdir(project)
    await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
    await $`git init`.cwd(project).quiet()
    await $`git -c core.fsmonitor=false add .`.cwd(project).quiet()

    const layer = snapshotLayer(root, project)
    const snapshots = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          const start = yield* snapshot.capture()
          expect(start).toBeDefined()
          if (!start) return
          yield* Effect.promise(() => fs.writeFile(path.join(project, "tracked.txt"), "one\ntwo\n"))
          const end = yield* snapshot.capture()
          expect(end).toBeDefined()
          if (!end) return
          return { start, end }
        }).pipe(Effect.provide(layer)),
      ),
    )
    expect(snapshots).toBeDefined()
    if (!snapshots) return

    const reader = createMemoryDiffReader({
      sessions: { get: () => Effect.succeed({} as Session.Info) },
      instances: Instance.Service.of({
        provide: () => (effect) => effect.pipe(Effect.provide(layer as Layer.Layer<Services>)),
      }),
    })
    const result = await Effect.runPromise(
      Effect.scoped(
        reader({
          sessionID: Session.ID.make("ses_memory_diff"),
          start: snapshots.start,
          end: snapshots.end,
        }),
      ),
    )

    expect(result).toEqual([
      {
        file: "tracked.txt",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ])
    expect(
      await Effect.runPromise(
        Effect.scoped(
          reader({
            sessionID: Session.ID.make("ses_memory_diff"),
            start: Snapshot.ID.make("missing-snapshot"),
            end: snapshots.end,
          }),
        ),
      ),
    ).toBeUndefined()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function snapshotLayer(data: string, directory: string) {
  return AppNodeBuilder.build(Snapshot.node, [
    Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({ data, config: path.join(data, "config") })),
  ]) as Layer.Layer<Snapshot.Service>
}
