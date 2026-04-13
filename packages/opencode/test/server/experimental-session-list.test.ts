// kilocode_change - new file
import { afterEach, describe, expect, mock, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
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

describe("experimental.session.list", () => {
  test("filters sessions by repo worktree family even when project IDs drift", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const worktree = path.join(first.path, "..", path.basename(first.path) + "-worktree")

    try {
      await $`git worktree add ${worktree} -b test-branch-${Date.now()}`.cwd(first.path).quiet()
      await Bun.write(path.join(first.path, ".git", "opencode"), "stale-project-id")

      const share = Config.get
      Config.get = async () => ({ share: "manual" }) as Awaited<ReturnType<typeof Config.get>>

      try {
        const { Server } = await import("../../src/server/server")
        const { Session } = await import("../../src/session/index")
        const root = await Instance.provide({
          directory: first.path,
          fn: async () => ({
            app: Server.Default(),
            project: await Server.Default().request("/project/current", {
              headers: { "x-kilo-directory": first.path },
            }),
            session: await Session.create({ title: "root-session" }),
          }),
        })

        const branch = await Instance.provide({
          directory: worktree,
          fn: async () => Session.create({ title: "worktree-session" }),
        })

        await Instance.provide({
          directory: second.path,
          fn: async () => Session.create({ title: "other-project-session" }),
        })

        const app = root.app
        const project = await root.project.json()
        const response = await app.request(
          `/experimental/session?projectID=${encodeURIComponent(project.id)}&roots=true&worktrees=true`,
          {
            headers: { "x-kilo-directory": first.path },
          },
        )

        expect(response.status).toBe(200)
        const body = await response.json()
        const ids = body.map((item: { id: string }) => item.id)
        const dirs = body.map((item: { directory: string }) => item.directory)

        expect(root.session.projectID).not.toBe(branch.projectID)
        expect(project.id).toBe(root.session.projectID)
        expect(ids).toContain(root.session.id)
        expect(ids).toContain(branch.id)
        expect(dirs).toContain(worktree)
        expect(body.some((item: { title: string }) => item.title === "other-project-session")).toBe(false)
      } finally {
        Config.get = share
      }
    } finally {
      await $`git worktree remove ${worktree}`.cwd(first.path).quiet().nothrow()
    }
  })
})
