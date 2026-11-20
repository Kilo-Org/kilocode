// Loaded only for explicit conversion. Inspecting a store during CLI boot needs SQLite, not the server's project graph.
import { Effect, Layer, References } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { importLegacyCredentials } from "@opencode/core/database/migration/20260805200742_import_legacy_credentials"
import { Project } from "@opencode/core/project"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"

export function migrate(file: string, data: string, mode: "profile" | "sessions", authFiles?: readonly string[]) {
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
        yield* V1Migration.run({
          nextDatabasePath: `${file}.none`,
          onSkippedRows: mode === "profile" ? rejectSkippedRows : undefined,
        }).pipe(Effect.provide(context))
        // A partially upgraded store may already have run the schema migration. Replay its
        // idempotent credential importer on the private candidate for every reconciled input.
        if (mode === "profile" && authFiles?.length) {
          const { db } = yield* Database.Service.pipe(Effect.provide(context))
          yield* db
            .transaction((tx) =>
              Effect.forEach(authFiles, (path) => importLegacyCredentials(tx, path), { discard: true }),
            )
            .pipe(
              Effect.catchCause(() =>
                Effect.fail(new Error(`Could not import sign-ins from ${authFiles.join(" and ")}.`)),
              ),
            )
        }
      }),
      // Only warnings reach the terminal, not an INFO log for every schema migration.
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
  )
}

function rejectSkippedRows(warnings: ReadonlyArray<V1Migration.Warning>) {
  // This diagnostic crosses process boundaries and is saved in the owner journal. Include
  // the row identifiers needed for repair, not transcript payloads or untrusted type values.
  const sample = warnings
    .slice(0, 3)
    .map(({ reason, messageID, partID }) => JSON.stringify({ reason, messageID, partID }))
  throw new Error(
    `Incomplete transcript for session ${JSON.stringify(warnings[0]!.sessionID)}: ${warnings.length} skipped row(s). ${sample.join("; ")}. The v1 database is still active.`,
  )
}
