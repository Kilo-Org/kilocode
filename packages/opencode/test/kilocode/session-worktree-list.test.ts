import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as Config from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { RemoteSender } from "../../src/kilo-sessions/remote-sender"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

beforeEach(() => {
  spyOn(RemoteSender, "create").mockReturnValue({ handle() {}, dispose() {} })
  spyOn(Config, "get").mockImplementation(async () => ({ share: "manual" }) as Awaited<ReturnType<typeof Config.get>>)
})

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

type Item = {
  id: string
  directory: string
  title: string
  worktreeDirectory?: string
  worktreeName?: string
}

describe("Kilo experimental session worktree list", () => {
  test("returns exact worktree directories for nested worktree sessions", async () => {
    await using repo = await tmpdir({ git: true })
    const worktree = path.join(repo.path, ".kilo", "worktrees", "nested")

    try {
      await fs.mkdir(path.dirname(worktree), { recursive: true })
      await Bun.write(path.join(repo.path, ".gitignore"), ".kilo/worktrees/\n")
      await $`git worktree add ${worktree} -b nested-${Date.now()}`.cwd(repo.path).quiet()

      const { Server } = await import("../../src/server/server")
      const { Session } = await import("../../src/session/session")

      const branch = await Instance.provide({
        directory: worktree,
        fn: async () => Session.create({ title: "nested-worktree-session" }),
      })
      const root = await Instance.provide({
        directory: repo.path,
        fn: async () => ({
          app: Server.Default().app,
          session: await Session.create({ title: "root-session" }),
        }),
      })

      const response = await root.app.request("/experimental/session?roots=true&worktrees=true", {
        headers: { "x-kilo-directory": repo.path },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as Item[]
      const base = body.find((item) => item.id === root.session.id)
      const nested = body.find((item) => item.id === branch.id)

      expect(base?.worktreeDirectory).toBe(repo.path)
      expect(base?.worktreeName).toBe(path.basename(repo.path))
      expect(nested?.worktreeDirectory).toBe(worktree)
      expect(nested?.worktreeName).toBe(path.basename(worktree))
    } finally {
      await $`git worktree remove ${worktree} --force`.cwd(repo.path).quiet().nothrow()
    }
  })

  test("keeps sessions for removed worktrees visible from the root repo", async () => {
    await using repo = await tmpdir({ git: true })
    const worktree = path.join(repo.path, "..", path.basename(repo.path) + "-removed")

    try {
      await $`git worktree add ${worktree} -b removed-${Date.now()}`.cwd(repo.path).quiet()

      const { Server } = await import("../../src/server/server")
      const { Session } = await import("../../src/session/session")

      const branch = await Instance.provide({
        directory: worktree,
        fn: async () => Session.create({ title: "removed-worktree-session" }),
      })
      const root = await Instance.provide({
        directory: repo.path,
        fn: async () => ({
          app: Server.Default().app,
          session: await Session.create({ title: "root-session" }),
        }),
      })

      await $`git worktree remove ${worktree} --force`.cwd(repo.path).quiet()
      await Instance.disposeAll()

      const response = await root.app.request("/experimental/session?roots=true&worktrees=true", {
        headers: { "x-kilo-directory": repo.path },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as Item[]
      const item = body.find((session) => session.id === branch.id)

      expect(item?.directory).toBe(worktree)
      expect(item?.worktreeDirectory).toBe(worktree)
      expect(item?.worktreeName).toBe(path.basename(worktree))
    } finally {
      await $`git worktree remove ${worktree} --force`.cwd(repo.path).quiet().nothrow()
    }
  })
})
