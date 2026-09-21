// kilocode_change - new file
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260828074139_kilocode_board",
  up(tx) {
    return Effect.gen(function* () {
      // kilocode_change start
      yield* tx.run(`
        CREATE TABLE \`kilo_board_message\` (
          \`id\` text PRIMARY KEY,
          \`board_root_session_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`sender_session_id\` text NOT NULL,
          \`recipient\` text NOT NULL,
          \`type\` text NOT NULL,
          \`body\` text NOT NULL,
          \`reply_to\` text,
          \`source_message_id\` text NOT NULL,
          \`source_call_id\` text NOT NULL,
          CONSTRAINT \`fk_kilo_board_message_board_root_session_id_kilo_board_root_session_id_fk\` FOREIGN KEY (\`board_root_session_id\`) REFERENCES \`kilo_board\`(\`root_session_id\`) ON DELETE CASCADE
        );
      `)
      // kilocode_change end
      // kilocode_change start
      yield* tx.run(`
        CREATE TABLE \`kilo_board\` (
          \`root_session_id\` text PRIMARY KEY,
          \`objective\` text NOT NULL,
          \`objective_message_id\` text,
          \`next_seq\` integer DEFAULT 1 NOT NULL,
          \`message_count\` integer DEFAULT 0 NOT NULL,
          \`message_bytes\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_kilo_board_root_session_id_session_id_fk\` FOREIGN KEY (\`root_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      // kilocode_change end
      // kilocode_change start
      yield* tx.run(
        `CREATE UNIQUE INDEX \`kilo_board_message_board_seq_idx\` ON \`kilo_board_message\` (\`board_root_session_id\`,\`seq\`);`,
      )
      // kilocode_change end
    })
  },
} satisfies DatabaseMigration.Migration
