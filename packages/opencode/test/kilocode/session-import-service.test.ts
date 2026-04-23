import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Database } from "../../src/storage"
import { SessionImportService } from "../../src/kilocode/session-import/service"

let spy: ReturnType<typeof spyOn>

const db = {
  select() {
    return {
      from() {
        return {
          where() {
            return {
              get() {
                return rows.session
              },
            }
          },
        }
      },
    }
  },
  delete() {
    return {
      where() {
        return {
          run() {
            deletes.push("session")
            rows.session = undefined
            rows.messages = []
            rows.parts = []
          },
        }
      },
    }
  },
  insert() {
    return {
      values(input: Record<string, unknown>) {
        return {
          onConflictDoUpdate() {
            return {
              run() {
                rows.session = { ...input }
              },
            }
          },
          run() {
            rows.session = { ...input }
          },
        }
      },
    }
  },
}

const rows = {
  session: undefined as Record<string, unknown> | undefined,
  messages: [] as string[],
  parts: [] as string[],
}

const deletes: string[] = []

function input(force?: boolean) {
  return {
    id: "ses_migrated_test",
    projectID: "proj_test",
    slug: "legacy-task",
    directory: "/workspace/testing",
    title: force ? "Reimported task" : "Legacy task",
    version: "v2",
    timeCreated: 1,
    timeUpdated: 1,
    ...(force ? { force: true } : {}),
  }
}

describe("SessionImportService.session", () => {
  beforeEach(() => {
    spy = spyOn(Database, "use").mockImplementation((fn: any) => fn(db))
    deletes.length = 0
    rows.session = undefined
    rows.messages = []
    rows.parts = []
  })

  afterEach(() => {
    spy.mockRestore()
  })

  test("returns skipped when the session already exists and force is false", async () => {
    rows.session = { id: "ses_migrated_test", title: "Legacy task" }

    const result = await SessionImportService.session(input())

    expect(result).toEqual({ ok: true, id: "ses_migrated_test", skipped: true })
    expect(deletes).toEqual([])
  })

  test("deletes and recreates the session when force is true", async () => {
    rows.session = { id: "ses_migrated_test", title: "Legacy task" }
    rows.messages = ["msg_test"]
    rows.parts = ["prt_test"]

    const result = await SessionImportService.session(input(true))

    expect(result).toEqual({ ok: true, id: "ses_migrated_test" })
    expect(deletes).toEqual(["session"])
    expect(rows.messages).toEqual([])
    expect(rows.parts).toEqual([])
    expect(rows.session).toMatchObject({ title: "Reimported task" })
  })
})
