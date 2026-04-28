import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { RemoteSender } from "../../src/kilo-sessions/remote-sender" // kilocode_change

// kilocode_change start
beforeEach(() => {
  spyOn(RemoteSender, "create").mockReturnValue({ handle() {}, dispose() {} })
})
// kilocode_change end

void Log.init({ print: false })

// kilocode_change start
afterEach(async () => {
  mock.restore()
  await resetDatabase()
})
// kilocode_change end

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  setArchived(input: z.output<typeof SessionNs.SetArchivedInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
}

describe("session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "second-session" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
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
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...svc.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-two" }),
    })

    const page = [...svc.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0]!.id).toBe(second.id)

    const next = [...svc.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0]!.time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  // kilocode_change start - project-family filter across worktrees (stale .git/kilo project ID)
  test("filters by project family across worktrees when project IDs drift", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const worktree = path.join(first.path, "..", path.basename(first.path) + "-worktree")

    try {
      await $`git worktree add ${worktree} -b test-branch-${Date.now()}`.cwd(first.path).quiet()

      // Create worktree session first so it computes its own project ID via rev-list
      const branch = await Instance.provide({
        directory: worktree,
        fn: async () => svc.create({ title: "worktree-session" }),
      })

      // Now write a stale project ID to .git/kilo — this overrides the root's cached ID
      await Bun.write(path.join(first.path, ".git", "kilo"), "stale-project-id")

      const root = await Instance.provide({
        directory: first.path,
        fn: async () => svc.create({ title: "root-session" }),
      })
      await Bun.file(path.join(first.path, ".git", "kilo")).delete()
      const other = await Instance.provide({
        directory: second.path,
        fn: async () => svc.create({ title: "other-session" }),
      })

      const sessions = [...svc.listGlobal({ projectID: root.projectID, roots: true, limit: 200 })]
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
  // kilocode_change end
})
