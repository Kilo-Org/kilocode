import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SessionInfo } from "@opencode/client"
import { ProjectContext } from "../src/agent-manager/project/context"
import { pushProjectSessions } from "../src/agent-manager/project/init"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

function info(id: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "prj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory },
  }
}

describe("Agent Manager session filing", () => {
  let root: string
  let one: string
  let two: string
  let state: WorktreeStateManager
  let ctx: ProjectContext

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-filing-"))
    one = path.join(root, ".kilo", "worktrees", "one")
    two = path.join(root, ".kilo", "worktrees", "two")
    fs.mkdirSync(one, { recursive: true })
    fs.mkdirSync(two, { recursive: true })
    fs.mkdirSync(path.join(root, ".kilo2"), { recursive: true })
    state = new WorktreeStateManager(root, () => undefined)
    ctx = new ProjectContext("project", root, true, { log: () => undefined, state: () => state })
    await ctx.ensureReady(async () => {
      ctx.stateManager()
      return { ok: true, refsFixed: 0 }
    })
  })

  afterEach(async () => {
    await state.flush()
    ctx.dispose()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("files sessions that an older build filed under another worktree under the worktree they run in", async () => {
    const first = state.addWorktree({ branch: "one", path: one, parentBranch: "main" })
    const second = state.addWorktree({ branch: "two", path: two, parentBranch: "main" })
    state.addSession("root-run", first.id)
    state.addSession("one-run", second.id)
    state.addSession("two-run", second.id)
    state.setTabOrder(second.id, ["one-run", "two-run"])
    const listed: Record<string, SessionInfo[]> = {
      [root]: [info("root-run", root)],
      [one]: [info("one-run", one)],
      [two]: [info("two-run", two)],
    }
    const posts: AgentManagerOutMessage[] = []
    let repairs = 0

    await pushProjectSessions(
      ctx,
      async (directory) => listed[directory] ?? [],
      (message) => posts.push(message),
      () => undefined,
      () => repairs++,
    )

    expect(state.getSession("root-run")?.worktreeId).toBeNull()
    expect(state.getSession("one-run")?.worktreeId).toBe(first.id)
    expect(state.getSession("two-run")?.worktreeId).toBe(second.id)
    expect(state.getTabOrder()[second.id]).toEqual(["two-run"])
    expect(repairs).toBe(1)
    const catalog = posts.find((message) => message.type === "agentManager.projectSessions")
    expect(
      catalog?.type === "agentManager.projectSessions"
        ? Object.fromEntries(catalog.sessions.map((item) => [item.id, item.worktreeId]))
        : undefined,
    ).toEqual({ "root-run": null, "one-run": first.id, "two-run": second.id })
  })

  it("leaves filings that match the server alone", async () => {
    const first = state.addWorktree({ branch: "one", path: one, parentBranch: "main" })
    state.addSession("one-run", first.id)
    let repairs = 0

    await pushProjectSessions(
      ctx,
      async (directory) => (directory === one ? [info("one-run", one)] : []),
      () => undefined,
      () => undefined,
      () => repairs++,
    )

    expect(state.getSession("one-run")?.worktreeId).toBe(first.id)
    expect(repairs).toBe(0)
  })
})
