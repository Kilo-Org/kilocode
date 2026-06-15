// kilocode_change - new file
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import type { InstanceContext } from "../../src/project/instance-context"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir, withTestInstance } from "../fixture/fixture"
import { RemoteSender } from "../../src/kilo-sessions/remote-sender"
import { Effect } from "effect"

beforeEach(() => {
  spyOn(RemoteSender, "create").mockReturnValue({ handle() {}, dispose() {} })
})

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

const create = async (title: string, ctx: InstanceContext) => {
  const [{ AppRuntime }, { Session }] = await Promise.all([
    import("../../src/effect/app-runtime"),
    import("../../src/session/session"),
  ])
  return AppRuntime.runPromise(
    Session.Service.use((svc) => svc.create({ title })).pipe(Effect.provideService(InstanceRef, ctx)),
  )
}

describe("experimental.session.list", () => {
  test("filters sessions by repo worktree family even when project IDs drift", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const worktree = path.join(first.path, "..", path.basename(first.path) + "-worktree")

    try {
      await $`git worktree add ${worktree} -b test-branch-${Date.now()}`.cwd(first.path).quiet()

      try {
        const { Server } = await import("../../src/server/server")

        // Create worktree session first so it computes its own project ID via rev-list
        const branch = await withTestInstance({
          directory: worktree,
          fn: (ctx) => create("worktree-session", ctx),
        })

        // Now write a stale project ID to .git/kilo — this overrides the root's cached ID
        await Bun.write(path.join(first.path, ".git", "kilo"), "stale-project-id")

        const root = await withTestInstance({
          directory: first.path,
          fn: async (ctx) => ({
            app: Server.Default().app,
            project: await Server.Default().app.request("/project/current", {
              headers: { "x-kilo-directory": first.path },
            }),
            session: await create("root-session", ctx),
          }),
        })
        await Bun.file(path.join(first.path, ".git", "kilo")).delete()

        await withTestInstance({
          directory: second.path,
          fn: (ctx) => create("other-project-session", ctx),
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
        mock.restore()
      }
    } finally {
      await $`git worktree remove ${worktree}`.cwd(first.path).quiet().nothrow()
    }
  })

  test("worktrees=true ignores SDK-injected directory query param", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const worktree = path.join(first.path, "..", path.basename(first.path) + "-worktree")

    try {
      await $`git worktree add ${worktree} -b test-branch-sdk-${Date.now()}`.cwd(first.path).quiet()

      try {
        const { Server } = await import("../../src/server/server")

        const branch = await withTestInstance({
          directory: worktree,
          fn: (ctx) => create("worktree-session", ctx),
        })

        const root = await withTestInstance({
          directory: first.path,
          fn: async (ctx) => ({
            app: Server.Default().app,
            project: await Server.Default().app.request("/project/current", {
              headers: { "x-kilo-directory": first.path },
            }),
            session: await create("root-session", ctx),
          }),
        })

        await withTestInstance({
          directory: second.path,
          fn: (ctx) => create("other-project-session", ctx),
        })

        const app = root.app
        const project = await root.project.json()

        // Include directory in query params — mimics what the SDK rewrite interceptor does.
        // Without the server fix, this would restrict results to only first.path sessions.
        const response = await app.request(
          `/experimental/session?projectID=${encodeURIComponent(project.id)}&roots=true&worktrees=true&directory=${encodeURIComponent(first.path)}`,
          {
            headers: { "x-kilo-directory": first.path },
          },
        )

        expect(response.status).toBe(200)
        const body = await response.json()
        const ids = body.map((item: { id: string }) => item.id)

        // Both root and worktree sessions must be returned despite directory= in query
        expect(ids).toContain(root.session.id)
        expect(ids).toContain(branch.id)
        expect(body.some((item: { title: string }) => item.title === "other-project-session")).toBe(false)
      } finally {
        mock.restore()
      }
    } finally {
      await $`git worktree remove ${worktree}`.cwd(first.path).quiet().nothrow()
    }
  })
})
