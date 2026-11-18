import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { handleGitChangesRequest } from "../src/kilo-provider/git-changes-request"
import { disposeGitChangesTarget } from "../src/kilo-provider/git-changes-target"
import type { ToWebview } from "../src/protocol"
import { exec } from "../src/util/process"

afterAll(() => disposeGitChangesTarget())

// A CI runner has no global git identity, so every commit names one explicitly.
const identity = ["-c", "user.name=Kilo", "-c", "user.email=kilo@example.com"]

async function repo(run: (dir: string) => Promise<void>) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-git-changes-")))
  try {
    await exec("git", ["init", "-q", "-b", "main", dir])
    await writeFile(path.join(dir, "a.txt"), "before\n")
    await exec("git", ["-C", dir, "add", "-A"])
    await exec("git", ["-C", dir, ...identity, "commit", "-q", "-m", "init"])
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function capture() {
  const posted: ToWebview[] = []
  return { posted, post: (message: ToWebview) => posted.push(message), error: (error: unknown) => String(error) }
}

describe("handleGitChangesRequest", () => {
  it("diffs a worktree against the base the webview names", async () => {
    await repo(async (dir) => {
      await exec("git", ["-C", dir, "checkout", "-q", "-b", "feature"])
      await writeFile(path.join(dir, "a.txt"), "after\n")
      await exec("git", ["-C", dir, ...identity, "commit", "-q", "-am", "change"])
      const ctx = capture()
      await handleGitChangesRequest(
        { type: "requestGitChangesContext", requestId: "git-1", directory: dir, base: "main" },
        { directory: "/elsewhere", ...ctx },
      )
      expect(ctx.posted).toHaveLength(1)
      const reply = ctx.posted[0]
      expect(reply?.type).toBe("gitChangesContextResult")
      if (reply?.type !== "gitChangesContextResult") return
      expect(reply.requestId).toBe("git-1")
      expect(reply.content).toContain(`Working directory: ${dir}`)
      expect(reply.content).toContain("Base: main")
      expect(reply.content).toContain("+after")
    })
  })

  it("shows the working tree changes of a branch without a base", async () => {
    await repo(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "edited\n")
      await writeFile(path.join(dir, "new.txt"), "fresh\n")
      const ctx = capture()
      await handleGitChangesRequest(
        { type: "requestGitChangesContext", requestId: "git-2", directory: dir },
        {
          directory: "/elsewhere",
          ...ctx,
        },
      )
      const reply = ctx.posted[0]
      if (reply?.type !== "gitChangesContextResult") throw new Error(`unexpected reply ${reply?.type}`)
      expect(reply.content).toContain("+edited")
      expect(reply.content).toContain("+++ b/new.txt")
    })
  })

  it("uses the host directory when the request names none", async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-no-git-")))
    try {
      const ctx = capture()
      await handleGitChangesRequest(
        { type: "requestGitChangesContext", requestId: "git-3" },
        { directory: dir, ...ctx },
      )
      const reply = ctx.posted[0]
      if (reply?.type !== "gitChangesContextResult") throw new Error(`unexpected reply ${reply?.type}`)
      expect(reply.content).toBe(`Working directory: ${dir}\n\nNot a git repository.`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
