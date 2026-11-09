import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/database/database"
import type { SessionSchema } from "../../src/session/schema"
import { SessionTable } from "../../src/session/sql"

/** Seed descendant ownership until V2 exposes subagent creation publicly. */
export const link = (child: SessionSchema.ID, parent: SessionSchema.ID) =>
  Database.Service.use(({ db }) =>
    db.update(SessionTable).set({ parent_id: parent }).where(eq(SessionTable.id, child)).run().pipe(Effect.orDie),
  )
