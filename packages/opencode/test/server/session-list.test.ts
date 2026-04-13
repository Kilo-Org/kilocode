import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema" // kilocode_change
import { ProjectTable } from "../../src/project/project.sql" // kilocode_change
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql" // kilocode_change
import { Database, eq } from "../../src/storage/db" // kilocode_change
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Session.list", () => {
  test("filters by directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({})

        await using other = await tmpdir({ git: true })
        const second = await Instance.provide({
          directory: other.path,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  // kilocode_change start: test legacy project id directory lookup
  test("includes directory matches from legacy project ids", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "legacy-session" })
        const project = ProjectID.make("legacy-project")
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: project,
              worktree: tmp.path,
              vcs: "git",
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [],
            })
            .run()
          db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id)).run()
        })

        const sessions = [...Session.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(session.id)
      },
    })
  })
  // kilocode_change end

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })
})
