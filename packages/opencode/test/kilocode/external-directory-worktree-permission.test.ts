import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("worktree external_directory permission", () => {
  test("does not ask when reading repo root from worktree session", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "root.txt"), "root content")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit -m init`.cwd(dir).quiet()
      },
    })

    const worktree = path.join(tmp.path, ".kilo", "worktrees", "read-root")
    await fs.mkdir(path.dirname(worktree), { recursive: true })
    await $`git worktree add ${worktree} -b feat-read-root`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: worktree,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(tmp.path, "root.txt") }, testCtx)
        const req = requests.find((item) => item.permission === "external_directory")
        expect(req).toBeUndefined()
      },
    })
  })
})
