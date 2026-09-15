import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260907102000_kilocode_model_usage_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`part_session_step_finish_idx\` ON \`part\` (\`session_id\`) WHERE json_valid("part"."data") AND json_extract("part"."data", '$.type') = 'step-finish';`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
