import { afterAll, afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ImportCommand } from "../../src/cli/cmd/import"
import { AppRuntime } from "../../src/effect/app-runtime"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { disposeAllInstances, disposeTestRuntime, tmpdir } from "../fixture/fixture"

const cwd = process.cwd()

afterEach(async () => {
  process.chdir(cwd)
  await disposeAllInstances()
})

afterAll(async () => {
  await AppRuntime.dispose()
  await disposeTestRuntime()
})

function session(id: SessionID, count: number, bad?: number) {
  const messages = Array.from({ length: count }, (_, index) => {
    const msg = MessageID.ascending()
    return {
      info: {
        id: msg,
        sessionID: id,
        role: "user",
        time: { created: Date.now() },
        agent: "code",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [
        {
          id: PartID.ascending(),
          sessionID: id,
          messageID: msg,
          type: "text",
          // the bad entry is missing its required `text`
          ...(index === bad ? {} : { text: `message ${index}` }),
        },
      ],
    }
  })
  return {
    info: {
      id,
      slug: "import-test",
      projectID: "global",
      directory: "/",
      title: "Import test",
      version: "0.0.0",
      time: { created: Date.now(), updated: Date.now() },
    },
    messages,
  }
}

async function run(dir: string, data: unknown) {
  const file = path.join(dir, "session.json")
  await fs.writeFile(file, JSON.stringify(data))
  process.chdir(dir)
  const handler = ImportCommand.handler
  if (!handler) throw new Error("import handler not provided")
  return Promise.resolve(handler({ file, _: [], $0: "kilo" } as never))
}

function count(id: SessionID) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = <T>(query: { all: () => Effect.Effect<T[], unknown> }) =>
        query.all().pipe(
          Effect.orDie,
          Effect.map((items) => items.length),
        )
      return {
        sessions: yield* rows(db.select().from(SessionTable).where(eq(SessionTable.id, id))),
        messages: yield* rows(db.select().from(MessageTable).where(eq(MessageTable.session_id, id))),
        parts: yield* rows(db.select().from(PartTable).where(eq(PartTable.session_id, id))),
      }
    }),
  )
}

describe("kilo import", () => {
  test("writes nothing when a later message fails validation", async () => {
    await using tmp = await tmpdir({ git: true })
    const id = SessionID.descending()

    await expect(run(tmp.path, session(id, 5, 3))).rejects.toThrow("Missing key")

    expect(await count(id)).toEqual({ sessions: 0, messages: 0, parts: 0 })
  })

  test("imports every message and part when the document is valid", async () => {
    await using tmp = await tmpdir({ git: true })
    const id = SessionID.descending()

    await run(tmp.path, session(id, 5))

    expect(await count(id)).toEqual({ sessions: 1, messages: 5, parts: 5 })
  })
})
