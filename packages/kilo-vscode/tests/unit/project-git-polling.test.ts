import { describe, expect, it } from "bun:test"
import { GitStatsPoller } from "../../src/agent-manager/GitStatsPoller"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import { GitOps } from "../../src/agent-manager/GitOps"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"
import type { WorktreeDiffEntry } from "../../src/agent-manager/types"

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(test: () => boolean, timeout = 500): Promise<void> {
  const start = Date.now()
  while (!test()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await wait(5)
  }
}

function worktree(id: string): Worktree {
  return {
    id,
    branch: `branch-${id}`,
    path: `/projects/${id}/worktree`,
    parentBranch: "main",
    remote: "origin",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function diff(): WorktreeDiffEntry[] {
  return [
    {
      file: "file.ts",
      patch: "",
      before: "",
      after: "",
      additions: 1,
      deletions: 0,
      status: "modified",
    },
  ]
}

describe("GitStatsPoller project routing", () => {
  it("resolves local stats through the requested project root", async () => {
    const roots = { frontend: "/projects/frontend", backend: "/projects/backend" }
    const calls: string[] = []
    const stats: string[] = []
    const git = new GitOps({
      log: () => undefined,
      runGit: async (args, cwd) => {
        calls.push(`${args[0]}:${cwd}`)
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "backend-feature"
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") return "origin/main"
        if (args[0] === "rev-list") return "0\t2"
        return ""
      },
    })
    const poller = new GitStatsPoller({
      projectId: "backend",
      getWorktrees: () => [],
      resolveWorkspaceRoot: (id) => roots[id as keyof typeof roots],
      localDiff: async (dir) => {
        calls.push(`diff:${dir}`)
        return diff()
      },
      onStats: () => undefined,
      onLocalStats: (value) => stats.push(value.branch),
      log: () => undefined,
      intervalMs: 5,
      git,
    })

    poller.setEnabled(true)
    await until(() => stats.length > 0)
    poller.stop()

    expect(stats).toEqual(["backend-feature"])
    expect(calls).toContain("rev-parse:/projects/backend")
    expect(calls).toContain("diff:/projects/backend")
    expect(calls.some((call) => call.includes("/projects/frontend"))).toBe(false)
  })

  it("does not poll when the requested project cannot resolve", async () => {
    let calls = 0
    const poller = new GitStatsPoller({
      projectId: "missing",
      getWorktrees: () => [],
      resolveWorkspaceRoot: () => undefined,
      localDiff: async () => diff(),
      onStats: () => undefined,
      onLocalStats: () => {
        calls += 1
      },
      log: () => undefined,
      intervalMs: 5,
      git: new GitOps({ log: () => undefined, runGit: async () => "" }),
    })

    poller.setEnabled(true)
    await wait(30)
    poller.stop()

    expect(calls).toBe(0)
  })
})

describe("PRStatusPoller project routing", () => {
  it("runs gh commands in the requested project root", async () => {
    const roots = { frontend: "/projects/frontend", backend: "/projects/backend" }
    const calls: string[] = []
    const statuses: string[] = []
    const poller = new PRStatusPoller({
      projectId: "backend",
      getWorktrees: () => [worktree("backend")],
      resolveWorkspaceRoot: (id) => roots[id as keyof typeof roots],
      run: async (cmd, args, options) => {
        calls.push(`${cmd}:${options?.cwd ?? ""}`)
        if (cmd === "gh" && args[0] === "--version") return { stdout: "gh version", stderr: "" }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return {
            stdout: JSON.stringify({
              number: 42,
              title: "Backend change",
              url: "https://github.com/acme/backend/pull/42",
              state: "OPEN",
              isDraft: false,
              reviewDecision: "APPROVED",
              additions: 2,
              deletions: 1,
              changedFiles: 1,
            }),
            stderr: "",
          }
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "checks") return { stdout: "[]", stderr: "" }
        throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`)
      },
      onStatus: (_id, pr) => {
        if (pr) statuses.push(pr.title)
      },
      log: () => undefined,
      intervalMs: 5,
    })

    poller.setEnabled(true)
    await until(() => statuses.length > 0)
    poller.stop()

    expect(statuses).toEqual(["Backend change"])
    expect(calls.some((call) => call.endsWith(":/projects/backend/worktree"))).toBe(true)
    expect(calls.some((call) => call.endsWith(":/projects/frontend/worktree"))).toBe(false)
  })
})
