import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { OrchestrationError, overview, prompt } from "../../src/agent-manager/orchestration-domain"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import type { PRStatus as AgentManagerPRStatus } from "../../src/agent-manager/types"

describe("Agent Manager orchestration domain", () => {
  let root: string
  let worktree: string
  let sectioned: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-"))
    worktree = path.join(root, "worktree")
    sectioned = path.join(root, "sectioned")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(worktree)
    fs.mkdirSync(sectioned)
    state = new WorktreeStateManager(root, () => undefined)
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("returns sectioned, ungrouped, local, and multiple-session summaries compactly", async () => {
    const first = state.addWorktree({ branch: "fix/first", path: worktree, parentBranch: "main" })
    const second = state.addWorktree({ branch: "fix/second", path: sectioned, parentBranch: "main", label: "Review" })
    const section = state.addSection("In review", "Blue", [second.id])
    state.addSession("ses_first", first.id)
    state.addSession("ses_second_a", second.id)
    state.addSession("ses_second_b", second.id)
    state.addSession("ses_local", null)
    state.setTabOrder(second.id, ["ses_second_b", "ses_second_a"])

    const dirs = new Map([
      ["ses_first", worktree],
      ["ses_second_a", sectioned],
      ["ses_second_b", sectioned],
      ["ses_local", root],
    ])
    const titles = new Map([
      ["ses_first", "First session"],
      ["ses_second_a", "Second A"],
      ["ses_second_b", "Second B"],
      ["ses_local", "Local session"],
    ])
    const get = mock(async (input: { sessionID: string; directory?: string }) => ({
      data: { id: input.sessionID, directory: input.directory, title: titles.get(input.sessionID) } as Session,
    }))
    const client = {
      session: {
        get,
        status: mock(async ({ directory }: { directory?: string }) => ({
          data:
            directory === sectioned
              ? { ses_second_a: { type: "retry", attempt: 1, message: "retry", next: 1 } }
              : directory === root
                ? { ses_local: { type: "busy" } }
                : {},
        })),
      },
      permission: {
        list: mock(async ({ directory }: { directory?: string }) => ({
          data: directory === root ? [{ id: "perm", sessionID: "ses_local" }] : [],
        })),
      },
      question: {
        list: mock(async ({ directory }: { directory?: string }) => ({
          data: directory === sectioned ? [{ id: "question", sessionID: "ses_second_b" }] : [],
        })),
      },
    } as unknown as KiloClient
    const cache = new Map<string, string>()
    const prs = new Map<string, AgentManagerPRStatus>([
      [
        second.id,
        {
          number: 42,
          title: "PR",
          url: "https://example.com/pr/42",
          state: "open",
          review: "approved",
          checks: { status: "success", total: 1, passed: 1, failed: 0, pending: 0, items: [] },
          comments: { total: 2, unresolved: 1, items: [] },
          additions: 10,
          deletions: 2,
          files: 1,
        },
      ],
    ])

    const result = await overview({
      client,
      root,
      state,
      titles: cache,
      stats: {
        worktrees: [
          { worktreeId: first.id, files: 1, additions: 3, deletions: 1, ahead: 1, behind: 0 },
          { worktreeId: second.id, files: 2, additions: 10, deletions: 2, ahead: 2, behind: 1 },
        ],
        local: { branch: "main", files: 1, additions: 1, deletions: 0, ahead: 0, behind: 0 },
      },
      prs,
    })

    expect(result.ungrouped).toEqual([
      expect.objectContaining({
        id: first.id,
        branch: "fix/first",
        session: expect.objectContaining({ id: "ses_first", activity: "idle" }),
        git: { additions: 3, deletions: 1, ahead: 1, behind: 0 },
      }),
    ])
    expect(result.sections).toEqual([
      {
        id: section.id,
        name: "In review",
        worktrees: [
          expect.objectContaining({
            id: second.id,
            name: "Review",
            sessions: [
              expect.objectContaining({ id: "ses_second_b", activity: "idle", attention: ["question"] }),
              expect.objectContaining({ id: "ses_second_a", activity: "retry" }),
            ],
            pullRequest: {
              number: 42,
              state: "open",
              checks: "success",
              review: "approved",
              unresolvedComments: 1,
            },
          }),
        ],
      },
    ])
    expect(result.local).toEqual(
      expect.objectContaining({
        branch: "main",
        sessions: [expect.objectContaining({ id: "ses_local", activity: "busy", attention: ["permission"] })],
      }),
    )
    expect(JSON.stringify(result)).not.toContain(root)
    expect(JSON.stringify(result)).not.toContain("items")
    expect(get).toHaveBeenCalledTimes(4)

    cache.set("ses_first", "")
    const cached = await overview({ client, root, state, titles: cache, stats: { worktrees: [] }, prs: new Map() })
    expect(cached.ungrouped[0]?.session?.name).toBe("ses_first")
    expect(get).toHaveBeenCalledTimes(4)

    const filtered = await overview({
      client,
      root,
      state,
      titles: cache,
      filter: { sectionIDs: [section.id], states: ["waiting"] },
      stats: { worktrees: [] },
      prs: new Map(),
    })
    expect(filtered.ungrouped).toEqual([])
    expect(filtered.local).toBeUndefined()
    expect(filtered.sections[0]?.worktrees[0]?.sessions).toBeUndefined()
    expect(filtered.sections[0]?.worktrees[0]?.session?.id).toBe("ses_second_b")
    expect(dirs.size).toBe(4)
  })

  it("delivers only to an idle managed session in its authoritative directory", async () => {
    const managed = state.addWorktree({ branch: "fix/prompt", path: worktree, parentBranch: "main" })
    state.addSession("ses_target", managed.id)
    const get = mock(async () => ({
      data: { id: "ses_target", directory: fs.realpathSync(worktree), title: "Target" } as Session,
    }))
    const promptAsync = mock(async () => ({ data: undefined }))
    const client = {
      session: {
        get,
        status: mock(async () => ({ data: {} })),
        promptAsync,
      },
    } as unknown as KiloClient

    await prompt({ client, root, state, sessionID: "ses_target", text: "Continue", messageID: "amr_prompt" })

    expect(get).toHaveBeenCalledWith({ sessionID: "ses_target", directory: worktree })
    expect(promptAsync).toHaveBeenCalledWith(
      {
        sessionID: "ses_target",
        directory: worktree,
        messageID: "msg_agent_manager_amr_prompt",
        parts: [{ type: "text", text: "Continue" }],
        snapshotInitialization: "wait",
      },
      { throwOnError: true },
    )
  })

  it("rejects unknown, stale, cross-workspace, and busy targets", async () => {
    const managed = state.addWorktree({ branch: "fix/errors", path: worktree, parentBranch: "main" })
    state.addSession("ses_target", managed.id)
    const promptAsync = mock(async () => ({ data: undefined }))
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_target", directory: root, title: "Target" } as Session })),
        status: mock(async () => ({ data: {} })),
        promptAsync,
      },
    } as unknown as KiloClient

    await expect(
      prompt({ client, root, state, sessionID: "ses_unknown", text: "Continue", messageID: "amr_unknown" }),
    ).rejects.toMatchObject({
      code: "unknown_session",
    } satisfies Partial<OrchestrationError>)
    await expect(
      prompt({ client, root, state, sessionID: "ses_target", text: "Continue", messageID: "amr_cross" }),
    ).rejects.toMatchObject({
      code: "cross_workspace",
    } satisfies Partial<OrchestrationError>)
    ;(client.session.get as ReturnType<typeof mock>).mockImplementation(async () => ({
      data: { id: "ses_target", directory: worktree, title: "Target" } as Session,
    }))
    ;(client.session.status as ReturnType<typeof mock>).mockImplementation(async () => ({
      data: { ses_target: { type: "busy" } },
    }))
    await expect(
      prompt({ client, root, state, sessionID: "ses_target", text: "Continue", messageID: "amr_busy" }),
    ).rejects.toMatchObject({
      code: "unavailable_session",
    } satisfies Partial<OrchestrationError>)

    fs.rmSync(worktree, { recursive: true, force: true })
    await expect(
      prompt({ client, root, state, sessionID: "ses_target", text: "Continue", messageID: "amr_stale" }),
    ).rejects.toMatchObject({
      code: "stale_session",
    } satisfies Partial<OrchestrationError>)
    expect(promptAsync).not.toHaveBeenCalled()
  })
})
