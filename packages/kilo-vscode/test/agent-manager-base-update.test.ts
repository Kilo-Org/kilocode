import { describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { SessionID } from "@opencode/schema/session-id"
import { handleBaseUpdate } from "../src/agent-manager/base-update"
import type { ProjectContext } from "../src/agent-manager/project/context"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import { baseUpdateTarget } from "../webview-ui/agent-manager/base-update-target"

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_one",
    projectID: "prj_one",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/repo/.kilo/worktrees/first" },
    ...overrides,
  }
}

const managed = [{ id: "ses_one", worktreeId: "wt-first" }]

describe("baseUpdateTarget", () => {
  it("targets the visible session with its model, variant and agent", () => {
    const info = session({
      model: { id: "deepseek-v4.1-flash", providerID: "kilo", variant: "high" },
      agent: "code",
    })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "deepseek-v4.1-flash" },
      variant: "high",
      agent: "code",
    })
  })

  it("omits a model that has no effort and a session that has no agent", () => {
    const info = session({ model: { id: "kilo-auto-free", providerID: "kilo" } })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "kilo-auto-free" },
    })
  })

  it("omits the server default effort marker so the host does not send it back as an effort", () => {
    const info = session({ model: { id: "kilo-auto-free", providerID: "kilo", variant: "default" } })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "kilo-auto-free" },
    })
  })

  it("leaves the host to choose when the managed state places the session in another worktree", () => {
    const info = session()

    expect(
      baseUpdateTarget({
        worktreeId: "wt-first",
        session: info,
        managedSessions: [{ id: "ses_one", worktreeId: "wt-second" }],
      }),
    ).toEqual({})
  })

  it("leaves the host to choose for a session only the catalog tagged with this worktree", () => {
    const info = session()

    // A session in the worktree directory that the managed state does not know is rejected by the host, so it
    // must not travel as a target.
    expect(
      baseUpdateTarget({
        worktreeId: "wt-first",
        session: info,
        managedSessions: [{ id: "ses_other", worktreeId: "wt-first" }],
      }),
    ).toEqual({})
  })

  it("leaves the host to choose when no session is visible", () => {
    expect(baseUpdateTarget({ worktreeId: "wt-first", session: undefined, managedSessions: managed })).toEqual({})
  })
})

describe("handleBaseUpdate delivery", () => {
  async function runUpdate(opts: {
    running: boolean
    preferred: "steer" | "queue"
    send?: "enter" | "alternate"
    hasPermission?: boolean
    hasQuestion?: boolean
  }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "am-base-update-"))
    const worktreePath = path.join(root, "wt")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(worktreePath)
    const state = new WorktreeStateManager(root, () => undefined)
    try {
      const wt = state.addWorktree({ branch: "fix/conflict", path: worktreePath, parentBranch: "main", remote: "origin" })
      state.addSession("ses_busy", wt.id)
      const prompts: Array<{ delivery?: string }> = []
      const errors: string[] = []
      const client = {
        session: {
          active: mock(async () => (opts.running ? { ses_busy: { type: "running" } } : {})),
          get: mock(async () => ({
            id: SessionID.make("ses_busy"),
            projectID: "prj_one",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            location: { directory: worktreePath },
          })),
          prompt: mock(async (input: { delivery?: string }) => {
            prompts.push(input)
            return {}
          }),
        },
        permission: {
          request: {
            list: mock(async () => ({
              location: { directory: worktreePath },
              data: opts.hasPermission ? [{ id: "perm_1", sessionID: "ses_busy" }] : [],
            })),
          },
        },
        form: {
          list: mock(async () => ({
            location: { directory: worktreePath },
            data: opts.hasQuestion
              ? [
                  {
                    id: "form_1",
                    sessionID: "ses_busy",
                    fields: [{ key: "choice", type: "string", title: "Pick one", options: [{ label: "A", value: "a" }] }],
                  },
                ]
              : [],
          })),
        },
      } as unknown as OpenCodeClient
      const ctx = {
        id: "prj_one",
        root,
        generation: 1,
        peekState: () => state,
        isCurrent: () => true,
      } as unknown as ProjectContext
      await handleBaseUpdate(
        {
          type: "agentManager.updateFromBase",
          projectId: "prj_one",
          worktreeId: wt.id,
          sessionId: "ses_busy",
          send: opts.send,
        },
        ctx,
        {
          client: async () => client,
          register: () => undefined,
          push: () => undefined,
          notify: (msg) => errors.push(msg),
          log: () => undefined,
        },
        false,
        opts.preferred,
      )
      return { prompts, errors }
    } finally {
      await state.flush()
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  }

  it("queues on Option-click while the target session runs, even when a permission is pending", async () => {
    const plain = await runUpdate({ running: true, preferred: "steer", send: "enter" })
    expect(plain.errors).toEqual([])
    expect(plain.prompts[0]?.delivery).toBe("steer")

    const queued = await runUpdate({ running: true, preferred: "steer", send: "alternate", hasPermission: true })
    expect(queued.errors).toEqual([])
    expect(queued.prompts[0]?.delivery).toBe("queue")

    const flipped = await runUpdate({ running: true, preferred: "queue", send: "alternate" })
    expect(flipped.errors).toEqual([])
    expect(flipped.prompts[0]?.delivery).toBe("steer")

    const idle = await runUpdate({ running: false, preferred: "queue", send: "alternate" })
    expect(idle.errors).toEqual([])
    expect(idle.prompts[0]?.delivery).toBe("steer")
  })

  it("still refuses a queued update while the target session waits for an answer", async () => {
    // A queued prompt may wait behind a permission, but an unanswered question parks the turn, so the update would
    // never run and the operation would report success for a prompt that did not execute.
    const queued = await runUpdate({ running: true, preferred: "steer", send: "alternate", hasQuestion: true })
    expect(queued.prompts).toEqual([])
    expect(queued.errors).toHaveLength(1)
    expect(queued.errors[0]).toContain("is waiting for input")

    const steered = await runUpdate({ running: true, preferred: "steer", send: "enter", hasQuestion: true })
    expect(steered.errors).toEqual([])
    expect(steered.prompts[0]?.delivery).toBe("steer")
  })
})
