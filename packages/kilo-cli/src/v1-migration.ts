// Loaded only for explicit conversion. Inspecting a store during CLI boot needs SQLite, not the server's project graph.
import { Effect, Layer, References } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { Project } from "@opencode/core/project"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"

export function migrate(file: string, data: string) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, FSUtil.node, Global.node]), [
            Database.node.replace(Database.configured({ path: file })),
            Global.node.replace(Global.layerWith({ data })),
          ]),
        )
        // A missing path: the import never pulls in an `opencode-next.db` that happens to lie in the data directory.
        yield* V1Migration.run({ nextDatabasePath: `${file}.none` }).pipe(Effect.provide(context))
      }),
      // Only warnings reach the terminal, not an INFO log for every schema migration.
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
  )
}
