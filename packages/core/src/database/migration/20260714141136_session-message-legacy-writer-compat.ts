// kilocode_change - new file
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260714141136_session-message-legacy-writer-compat",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`__new_session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`INSERT INTO \`__new_session_message\`(\`id\`, \`session_id\`, \`type\`, \`seq\`, \`time_created\`, \`time_updated\`, \`data\`) SELECT \`id\`, \`session_id\`, \`type\`, \`seq\`, \`time_created\`, \`time_updated\`, \`data\` FROM \`session_message\`;`)
      yield* tx.run(`DROP TABLE \`session_message\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session_message\` RENAME TO \`session_message\`;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
