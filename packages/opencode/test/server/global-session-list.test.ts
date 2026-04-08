// kilocode_change - new file
import { $ } from "bun"
import { afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

mock.module("@/kilo-sessions/remote-sender", () => ({
  RemoteSender: {
    create() {
      return {
        handle() {},
        dispose() {},
      }
    },
  },
}))

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("Session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    const { Session } = await import("../../src/session/index")
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "second-session" }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    const { Session } = await import("../../src/session/index")
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...Session.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    const { Session } = await import("../../src/session/index")
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-two" }),
    })

    const page = [...Session.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0]!.id).toBe(second.id)

    const next = [...Session.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0]!.time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("filters by project family across worktrees when project IDs drift", async () => {
    const { Session } = await import("../../src/session/index")
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const worktree = path.join(first.path, "..", path.basename(first.path) + "-worktree")

    try {
      await $`git worktree add ${worktree} -b test-branch-${Date.now()}`.cwd(first.path).quiet()
      await Bun.write(path.join(first.path, ".git", "opencode"), "stale-project-id")

      const root = await Instance.provide({
        directory: first.path,
        fn: async () => Session.create({ title: "root-session" }),
      })
      const branch = await Instance.provide({
        directory: worktree,
        fn: async () => Session.create({ title: "worktree-session" }),
      })
      const other = await Instance.provide({
        directory: second.path,
        fn: async () => Session.create({ title: "other-session" }),
      })

      const sessions = [...Session.listGlobal({ projectID: root.projectID, roots: true, limit: 200 })]
      const ids = sessions.map((session) => session.id)

      expect(root.projectID).not.toBe(branch.projectID)
      expect(ids).toContain(root.id)
      expect(ids).toContain(branch.id)
      expect(ids).not.toContain(other.id)
      expect(sessions.find((session) => session.id === branch.id)?.directory).toBe(worktree)
    } finally {
      await $`git worktree remove ${worktree}`.cwd(first.path).quiet().nothrow()
    }
  })
})
