import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { KiloClient, QuestionRequest, Session } from "@kilocode/sdk/v2/client"
import { OrchestrationError, answer, move, overview, prompt } from "../../src/agent-manager/orchestration-domain"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { collectProjectSessions } from "../../src/agent-manager/project/init"
import type { PRStatus as AgentManagerPRStatus } from "../../src/agent-manager/types"

const noQuestions: QuestionRequest[] = []

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
          checks: { status: "success", total: 1, passed: 1, failed: 0, pending: 0, checks: [] },
          comments: { total: 2, unresolved: 1, comments: [], reviewers: [] },
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
      permission: {
        list: mock(async () => ({ data: [] })),
      },
      question: {
        list: mock(async () => ({ data: noQuestions })),
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

  it("prompts, answers, and moves a session discovered in a managed worktree", async () => {
    const wt = state.addWorktree({ branch: "fix/discovered", path: worktree, parentBranch: "main" })
    const section = state.addSection("Review", null)
    const session = {
      id: "ses_discovered",
      slug: "discovered",
      projectID: "prj-test",
      directory: worktree,
      title: "Discovered",
      version: "1",
      time: { created: 1, updated: 1 },
    } satisfies Session
    const ctx = new ProjectContext("prj-test", root, true, { log: () => undefined, state: () => state })
    ctx.stateManager()
    const views = await collectProjectSessions(ctx, {
      listSessions: async (dir) => (dir === worktree ? [session] : []),
      setSessionDirectory: () => undefined,
    })
    expect(views).toEqual([expect.objectContaining({ id: session.id, worktreeId: wt.id })])
    ctx.setSessions(views)
    expect(state.getSession(session.id)).toBeUndefined()
    const managed = { id: session.id, worktreeId: views[0]!.worktreeId, createdAt: views[0]!.createdAt }

    const questions: QuestionRequest[] = []
    const delivered = mock(async () => ({ data: undefined }))
    const replied = mock(async () => ({ data: true }))
    const client = {
      session: {
        get: mock(async () => ({ data: session })),
        status: mock(async () => ({ data: {} })),
        promptAsync: delivered,
      },
      permission: { list: mock(async () => ({ data: [] })) },
      question: { list: mock(async () => ({ data: questions })), reply: replied },
    } as unknown as KiloClient

    await prompt({ client, root, state, sessionID: session.id, text: "Continue", messageID: "amr_discovered", managed })
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ sessionID: session.id, directory: worktree }), {
      throwOnError: true,
    })

    questions.push({
      id: "que_discovered",
      sessionID: session.id,
      questions: [{ header: "Approve", question: "Proceed?", options: [{ label: "Yes", description: "Continue" }] }],
    })
    await answer({ client, root, state, sessionID: session.id, answers: [["Yes"]], managed })
    expect(replied).toHaveBeenCalledWith(
      { requestID: "que_discovered", answers: [["Yes"]], directory: worktree },
      { throwOnError: true },
    )

    move({ state, sessionID: session.id, sectionID: section.id, managed })
    expect(state.getWorktree(wt.id)?.sectionId).toBe(section.id)
    expect(state.getSession(session.id)).toBeUndefined()
  })

  it("recognizes a worktree session received through a live lifecycle event", async () => {
    const wt = state.addWorktree({ branch: "fix/live", path: worktree, parentBranch: "main" })
    const ctx = new ProjectContext("prj-test", root, true, { log: () => undefined, state: () => state })
    ctx.stateManager()
    ctx.upsertSession({
      id: "ses_live",
      parentID: null,
      title: "Live",
      createdAt: "",
      updatedAt: "",
      revert: null,
      summary: null,
      worktreeId: wt.id,
    })

    expect(ctx.hasLiveSession("ses_live")).toBe(true)
    expect(state.getSession("ses_live")).toBeUndefined()
    const managed = { id: "ses_live", worktreeId: wt.id, createdAt: "" }
    const delivered = mock(async () => ({ data: undefined }))
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_live", directory: worktree, title: "Live" } as Session })),
        status: mock(async () => ({ data: {} })),
        promptAsync: delivered,
      },
      permission: { list: mock(async () => ({ data: [] })) },
      question: { list: mock(async () => ({ data: [] })) },
    } as unknown as KiloClient

    await prompt({ client, root, state, sessionID: "ses_live", text: "Continue", messageID: "amr_live", managed })
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ directory: worktree }), { throwOnError: true })
  })

  it("waits for a busy managed session to become idle before prompting", async () => {
    const managed = state.addWorktree({ branch: "fix/wait", path: worktree, parentBranch: "main" })
    state.addSession("ses_wait", managed.id)
    let calls = 0
    const promptAsync = mock(async () => ({ data: undefined }))
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_wait", directory: worktree, title: "Wait" } as Session })),
        status: mock(async () => ({ data: calls++ === 0 ? { ses_wait: { type: "busy" } } : {} })),
        promptAsync,
      },
      permission: {
        list: mock(async () => ({ data: [] })),
      },
      question: {
        list: mock(async () => ({ data: noQuestions })),
      },
    } as unknown as KiloClient

    await prompt({ client, root, state, sessionID: "ses_wait", text: "Continue", messageID: "amr_wait" })

    expect(client.session.status).toHaveBeenCalledTimes(2)
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it("fails fast with the pending question named instead of waiting out the idle timeout", async () => {
    const managed = state.addWorktree({ branch: "fix/blocked", path: worktree, parentBranch: "main" })
    state.addSession("ses_blocked", managed.id)
    const promptAsync = mock(async () => ({ data: undefined }))
    const question: QuestionRequest = {
      id: "que_1",
      sessionID: "ses_blocked",
      questions: [
        {
          header: "Deploy",
          question: "Should I deploy to production now?",
          options: [
            { label: "Yes", description: "Deploy now" },
            { label: "No", description: "Wait" },
          ],
        },
        {
          header: "Region",
          question: "Which region should receive the deployment?",
          options: [
            { label: "US", description: "Deploy to the US" },
            { label: "EU", description: "Deploy to the EU" },
          ],
        },
      ],
    }
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_blocked", directory: worktree, title: "Blocked" } as Session })),
        status: mock(async () => ({ data: { ses_blocked: { type: "busy" } } })),
        promptAsync,
      },
      permission: {
        list: mock(async () => ({ data: [] })),
      },
      question: {
        list: mock(async () => ({ data: [question] })),
      },
    } as unknown as KiloClient

    await expect(
      prompt({ client, root, state, sessionID: "ses_blocked", text: "Continue", messageID: "amr_blocked" }),
    ).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining('sessionID "ses_blocked"'),
    })

    const failure = await prompt({
      client,
      root,
      state,
      sessionID: "ses_blocked",
      text: "Continue",
      messageID: "amr_blocked2",
    }).then(
      () => undefined,
      (error: OrchestrationError) => error,
    )
    expect(failure?.message).toContain('questionID "que_1"')
    expect(failure?.message).toContain('"Should I deploy to production now?"')
    expect(failure?.message).toContain("(options: Yes, No)")
    expect(failure?.message).toContain('"Which region should receive the deployment?"')
    expect(failure?.message).toContain("(options: US, EU)")
    expect(failure?.message).toContain("one label array per question in that request (2 total)")
    expect(client.question.list).toHaveBeenCalledTimes(2)
    expect(promptAsync).not.toHaveBeenCalled()
  })

  it("fails closed when pending blocker state cannot be read", async () => {
    const managed = state.addWorktree({ branch: "fix/blocker-error", path: worktree, parentBranch: "main" })
    state.addSession("ses_blocker_error", managed.id)
    const client = {
      session: {
        get: mock(async () => ({
          data: { id: "ses_blocker_error", directory: worktree, title: "Blocker error" } as Session,
        })),
      },
      permission: {
        list: mock(async () => ({ error: { message: "offline" } })),
      },
      question: {
        list: mock(async () => ({ data: noQuestions })),
      },
    } as unknown as KiloClient

    await expect(
      prompt({ client, root, state, sessionID: "ses_blocker_error", text: "Continue", messageID: "amr_error" }),
    ).rejects.toMatchObject({
      code: "host_error",
      message: "The managed session blockers could not be read",
    } satisfies Partial<OrchestrationError>)
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
      // Permission replies remain out of scope. This empty read keeps the test focused on question/idle handling.
      permission: {
        list: mock(async () => ({ data: [] })),
      },
      question: {
        list: mock(async () => ({ data: noQuestions })),
      },
    } as unknown as KiloClient

    await expect(
      prompt({ client, root, state, sessionID: "ses_unknown", text: "Continue", messageID: "amr_unknown" }),
    ).rejects.toMatchObject({
      code: "unknown_session",
    } satisfies Partial<OrchestrationError>)
    await expect(
      prompt({
        client,
        root,
        state,
        sessionID: "ses_unknown",
        text: "Continue",
        messageID: "amr_mismatch",
        managed: { id: "ses_target", worktreeId: managed.id, createdAt: "" },
      }),
    ).rejects.toMatchObject({ code: "unknown_session" } satisfies Partial<OrchestrationError>)
    await expect(
      prompt({
        client,
        root,
        state,
        sessionID: "ses_foreign",
        text: "Continue",
        messageID: "amr_foreign",
        managed: { id: "ses_foreign", worktreeId: "wt_foreign", createdAt: "" },
      }),
    ).rejects.toMatchObject({ code: "stale_session" } satisfies Partial<OrchestrationError>)
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
      prompt({
        client,
        root,
        state,
        sessionID: "ses_target",
        text: "Continue",
        messageID: "amr_busy",
        idleTimeoutMs: 0,
      }),
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

  it("answers the sole pending question without a question ID", async () => {
    const managed = state.addWorktree({ branch: "fix/answer", path: worktree, parentBranch: "main" })
    state.addSession("ses_ask", managed.id)
    const reply = mock(async () => ({ data: true }))
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_ask", directory: worktree, title: "Ask" } as Session })),
      },
      question: {
        list: mock(async () => ({
          data: [
            {
              id: "que_solo",
              sessionID: "ses_ask",
              questions: [
                {
                  header: "Deploy",
                  question: "Deploy now?",
                  options: [{ label: "Yes", description: "ok" }],
                },
              ],
            } satisfies QuestionRequest,
          ],
        })),
        reply,
      },
    } as unknown as KiloClient

    const resolved = await answer({ client, root, state, sessionID: "ses_ask", answers: [["Yes"]] })

    expect(resolved).toEqual({ questionID: "que_solo" })
    expect(reply).toHaveBeenCalledWith(
      { requestID: "que_solo", answers: [["Yes"]], directory: worktree },
      { throwOnError: true },
    )
  })

  it("requires a question ID when several are pending and validates answers per question", async () => {
    const managed = state.addWorktree({ branch: "fix/answer-many", path: worktree, parentBranch: "main" })
    state.addSession("ses_many", managed.id)
    const reply = mock(async () => ({ data: true }))
    const pending: QuestionRequest[] = [
      { id: "que_a", sessionID: "ses_many", questions: [{ header: "A", question: "First?", options: [] }] },
      { id: "que_b", sessionID: "ses_many", questions: [{ header: "B", question: "Second?", options: [] }] },
    ]
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_many", directory: worktree, title: "Many" } as Session })),
      },
      question: {
        list: mock(async () => ({ data: pending })),
        reply,
      },
    } as unknown as KiloClient

    await expect(answer({ client, root, state, sessionID: "ses_many", answers: [["x"]] })).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining("que_a"),
    })
    await expect(
      answer({ client, root, state, sessionID: "ses_many", questionID: "que_b", answers: [["x"], ["y"]] }),
    ).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining("one answer array per question (1)"),
    })

    const resolved = await answer({
      client,
      root,
      state,
      sessionID: "ses_many",
      questionID: "que_b",
      answers: [["go"]],
    })
    expect(resolved).toEqual({ questionID: "que_b" })
    expect(reply).toHaveBeenCalledWith(
      { requestID: "que_b", answers: [["go"]], directory: worktree },
      { throwOnError: true },
    )
  })

  it("rejects answering when nothing or something foreign is pending", async () => {
    const managed = state.addWorktree({ branch: "fix/answer-none", path: worktree, parentBranch: "main" })
    state.addSession("ses_none", managed.id)
    const reply = mock(async () => ({ data: true }))
    const client = {
      session: {
        get: mock(async () => ({ data: { id: "ses_none", directory: worktree, title: "None" } as Session })),
      },
      question: {
        list: mock(async () => ({
          data: [
            {
              id: "que_other",
              sessionID: "ses_stranger",
              questions: [{ header: "X", question: "Other session's question", options: [] }],
            } satisfies QuestionRequest,
          ],
        })),
        reply,
      },
    } as unknown as KiloClient

    await expect(answer({ client, root, state, sessionID: "ses_none", answers: [["x"]] })).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining("no pending question"),
    })
    const dead = await answer({ client, root, state, sessionID: "ses_none", answers: [["x"]] }).then(
      (value) => undefined,
      (error: OrchestrationError) => error,
    )
    expect(dead?.message).toContain("Sessions with pending questions: ses_stranger (question que_other)")
    await expect(
      answer({ client, root, state, sessionID: "ses_none", questionID: "que_other", answers: [["x"]] }),
    ).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining("no pending question"),
    })
    await expect(answer({ client, root, state, sessionID: "ses_unknown", answers: [["x"]] })).rejects.toMatchObject({
      code: "unknown_session",
    } satisfies Partial<OrchestrationError>)
    expect(reply).not.toHaveBeenCalled()
  })
})
