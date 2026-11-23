// kilocode_change - new file
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261028192305_kilocode_continuation_intent",
  up(tx) {
    return Effect.gen(function* () {
      // kilocode_change start
      yield* tx.run(`
        CREATE TABLE \`kilo_continuation_intent\` (
          \`account_id\` text NOT NULL,
          \`operation_key\` text NOT NULL,
          \`selection_json\` text NOT NULL,
          \`cloud_origin\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`prepared_json\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT \`kilo_continuation_intent_pk\` PRIMARY KEY(\`account_id\`, \`operation_key\`)
        );
      `)
      // kilocode_change end
    })
  },
} satisfies DatabaseMigration.Migration
