import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AgentManagerService } from "../../src/kilocode/agent-manager/service"
import { Filesystem } from "../../src/util/filesystem"

// InstanceBootstrap spawns async file watchers, ripgrep scans, etc. inside
// Worktree.create's setTimeout. We need to let those complete before the
// tmpdir is cleaned up, otherwise bun attributes the ENOENT to the next test.
const settle = () => new Promise((r) => setTimeout(r, 1_000))

describe("AgentManagerService", () => {
  test(
    "creates grouped parallel sessions and lists them",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const created = await AgentManagerService.create({
            prompt: "Build feature X",
            versions: [
              {
                label: "api",
              },
              {
                label: "ui",
              },
            ],
          })

          expect(created.groupID).toBeDefined()
          expect(created.sessions.length).toBe(2)
          expect(created.sessions[0]?.sessionID).toBeDefined()
          expect(created.sessions[1]?.sessionID).toBeDefined()

          const listed = await AgentManagerService.list({ groupID: created.groupID })
          expect(listed.sessions.length).toBe(2)
          expect(
            listed.sessions.every((item: (typeof listed.sessions)[number]) => item.groupID === created.groupID),
          ).toBe(true)

          for (const session of created.sessions) {
            await AgentManagerService.cancel({ sessionID: session.sessionID }).catch(() => undefined)
          }
          await settle()
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "returns paginated diffs and cancels sessions",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const created = await AgentManagerService.create({
            prompt: "Implement feature Y",
          })

          const first = created.sessions[0]
          expect(first).toBeDefined()
          if (!first) return

          const added = path.join(first.worktree.path, "agent-manager-added.txt")
          await Bun.write(added, "hello from managed session\n")

          const diffMeta = await AgentManagerService.diff({
            sessionID: first.sessionID,
            limit: 1,
            includePatch: false,
          })

          expect(diffMeta.files.length).toBe(1)
          expect(diffMeta.summary.totalFiles).toBeGreaterThan(0)
          expect(diffMeta.files[0]?.path).toContain("agent-manager-added.txt")

          const diffPatch = await AgentManagerService.diff({
            sessionID: first.sessionID,
            includePatch: true,
          })
          const match = diffPatch.files.find((item: (typeof diffPatch.files)[number]) =>
            item.path.endsWith("agent-manager-added.txt"),
          )
          expect(match?.status).toBe("added")

          const cancelled = await AgentManagerService.cancel({ sessionID: first.sessionID })
          expect(cancelled).toBe(true)
          expect(await Filesystem.exists(first.worktree.path)).toBe(false)
          await settle()
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "allows per-version prompts without top-level prompt",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const created = await AgentManagerService.create({
            versions: [
              {
                label: "api",
                prompt: "Build the API layer",
              },
              {
                label: "ui",
                prompt: "Build the UI layer",
              },
            ],
          })

          expect(created.sessions.length).toBe(2)
          expect(created.sessions[0]?.sessionID).toBeDefined()
          expect(created.sessions[1]?.sessionID).toBeDefined()

          for (const session of created.sessions) {
            await AgentManagerService.cancel({ sessionID: session.sessionID }).catch(() => undefined)
          }
          await settle()
        },
      })
    },
    { timeout: 30_000 },
  )

  test("rejects when no prompt is provided at any level", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          AgentManagerService.create({
            versions: [
              {
                label: "api",
              },
            ],
          }),
        ).rejects.toThrow("Prompt is required")
      },
    })
  })
})
