import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { FormInfo, OpenCodeClient, SessionInfo } from "@opencode/client"
import { SessionID } from "@opencode/schema/session-id"
import { OrchestrationError, answer, move, overview, prompt } from "../src/agent-manager/orchestration-domain"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import type { PRStatus as AgentManagerPRStatus } from "../src/agent-manager/types"

function info(id: string, directory: string, title?: string): SessionInfo {
  return {
    id: SessionID.make(id),
    projectID: "prj-test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title,
    location: { directory },
  }
}

function form(id: string, sessionID: string, field: Partial<FormInfo["fields"][number]>): FormInfo {
  return {
    id,
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        title: "Approve",
        description: "Proceed?",
        options: [{ value: "Yes", label: "Yes", description: "go" }],
        custom: true,
        ...field,
      },
    ] as FormInfo["fields"],
  }
}

function empty<T>(directory: string): { location: { directory: string }; data: T[] } {
  return { location: { directory }, data: [] }
}

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

    const titles = new Map([
      ["ses_first", "First session"],
      ["ses_second_a", "Second A"],
      ["ses_second_b", "Second B"],
      ["ses_local", "Local session"],
    ])
    const dirs = new Map([
      ["ses_first", worktree],
      ["ses_second_a", sectioned],
      ["ses_second_b", sectioned],
      ["ses_local", root],
    ])
    const get = mock(async (input: { sessionID: string }) =>
      info(input.sessionID, dirs.get(input.sessionID) ?? root, titles.get(input.sessionID)),
    )
    const client = {
      session: {
        get,
        active: mock(async () => ({ ses_second_a: { type: "running" } })),
      },
      permission: {
        request: {
          list: mock(async ({ location }: { location: { directory: string } }) => ({
            location,
            data: location.directory === root ? [{ id: "perm", sessionID: "ses_local" }] : [],
          })),
        },
      },
      form: {
        list: mock(async ({ location }: { location: { directory: string } }) => ({
          location,
          data: location.directory === sectioned ? [form("question", "ses_second_b", {})] : [],
        })),
      },
    } as unknown as OpenCodeClient
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
          reviewers: [],
          comments: { total: 2, unresolved: 1, comments: [] },
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
              expect.objectContaining({ id: "ses_second_a", activity: "busy" }),
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
        sessions: [expect.objectContaining({ id: "ses_local", activity: "idle", attention: ["permission"] })],
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
    expect(String(filtered.sections[0]?.worktrees[0]?.session?.id)).toBe("ses_second_b")
  })

  it("delivers to a managed session in its authoritative directory", async () => {
    const managed = state.addWorktree({ branch: "fix/prompt", path: worktree, parentBranch: "main" })
    state.addSession("ses_target", managed.id)
    const get = mock(async () => info("ses_target", fs.realpathSync(worktree), "Target"))
    const delivered = mock(async () => undefined)
    const client = {
      session: { get, prompt: delivered },
      permission: { request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await prompt({ client, root, state, sessionID: "ses_target", text: "Continue" })

    expect(get).toHaveBeenCalledWith({ sessionID: "ses_target" })
    expect(delivered).toHaveBeenCalledWith({ sessionID: "ses_target", text: "Continue" })
  })

  it("lets the backend assign a message ID so peer prompts are never scoped out", async () => {
    const delivered = mock(async (_input: { id?: string }) => undefined)
    const client = {
      session: { get: mock(async () => info("ses_caller", fs.realpathSync(root), "Caller")), prompt: delivered },
      permission: { request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await prompt({ client, root, state, sessionID: "ses_caller", directory: root, text: "Peer" })

    const sent = delivered.mock.calls.at(0)?.at(0)
    expect(sent).toBeDefined()
    expect(sent?.id).toBeUndefined()
  })

  it("delivers a reply to a verified original session outside Agent Manager state", async () => {
    const delivered = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => info("ses_caller", fs.realpathSync(root), "Caller")), prompt: delivered },
      permission: { request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await prompt({ client, root, state, sessionID: "ses_caller", directory: root, text: "Reply" })

    expect(delivered).toHaveBeenCalledWith({ sessionID: "ses_caller", text: "Reply" })
  })

  it("prompts, answers, and moves a session discovered in a managed worktree", async () => {
    const wt = state.addWorktree({ branch: "fix/discovered", path: worktree, parentBranch: "main" })
    const section = state.addSection("Review", null)
    const session = info("ses_discovered", worktree, "Discovered")
    const forms: FormInfo[] = []
    const delivered = mock(async () => undefined)
    const replied = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => session), prompt: delivered, form: { reply: replied } },
      permission: { request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => ({ location, data: forms })) },
    } as unknown as OpenCodeClient
    const managed = { id: session.id, worktreeId: wt.id, createdAt: "" }

    await prompt({ client, root, state, sessionID: session.id, text: "Continue", managed })
    expect(delivered).toHaveBeenCalledWith({ sessionID: session.id, text: "Continue" })

    forms.push(form("que_discovered", session.id, {}))
    await answer({ client, root, state, sessionID: session.id, answers: [["Yes"]], managed })
    expect(replied).toHaveBeenCalledWith({
      sessionID: session.id,
      formID: "que_discovered",
      answer: { q0: "Yes" },
    })

    move({ state, sessionID: session.id, sectionID: section.id, managed })
    expect(state.getWorktree(wt.id)?.sectionId).toBe(section.id)
    expect(state.getSession(session.id)).toBeUndefined()
  })

  it("submits prompts to a running session without waiting for idle", async () => {
    const managed = state.addWorktree({ branch: "fix/queue", path: worktree, parentBranch: "main" })
    state.addSession("ses_queue", managed.id)
    const delivered = mock(async () => undefined)
    const client = {
      session: {
        get: mock(async () => info("ses_queue", worktree, "Queue")),
        active: mock(async () => ({ ses_queue: { type: "running" } })),
        prompt: delivered,
        interrupt: mock(async () => undefined),
      },
      permission: { request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await prompt({ client, root, state, sessionID: "ses_queue", text: "Continue" })

    expect(client.session.active).not.toHaveBeenCalled()
    expect(client.session.interrupt).not.toHaveBeenCalled()
    expect(delivered).toHaveBeenCalledTimes(1)
    expect(delivered).toHaveBeenCalledWith({ sessionID: "ses_queue", text: "Continue" })
  })

  it("rejects prompts to a session with a pending permission", async () => {
    state.addSession("ses_blocked", null)
    const delivered = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => info("ses_blocked", root, "Blocked")), prompt: delivered },
      permission: {
        request: {
          list: mock(async ({ location }: { location: { directory: string } }) => ({
            location,
            data: [{ id: "perm_1", sessionID: "ses_blocked" }],
          })),
        },
      },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await expect(prompt({ client, root, state, sessionID: "ses_blocked", text: "Continue" })).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining("pending permission request"),
    })
    expect(delivered).not.toHaveBeenCalled()
  })

  it("does not submit a prompt cancelled during validation", async () => {
    state.addSession("ses_cancelled", null)
    const controller = new AbortController()
    const delivered = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => info("ses_cancelled", root, "Cancelled")), prompt: delivered },
      permission: {
        request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
      },
      form: {
        list: mock(async ({ location }: { location: { directory: string } }) => {
          controller.abort()
          return empty(location.directory)
        }),
      },
    } as unknown as OpenCodeClient

    await prompt({
      client,
      root,
      state,
      sessionID: "ses_cancelled",
      text: "Continue",
      signal: controller.signal,
    })

    expect(delivered).not.toHaveBeenCalled()
  })

  it("rejects prompts with the pending question and answer options named", async () => {
    const managed = state.addWorktree({ branch: "fix/blocked", path: worktree, parentBranch: "main" })
    state.addSession("ses_blocked", managed.id)
    const delivered = mock(async () => undefined)
    const pending = form("que_1", "ses_blocked", {})
    pending.fields = [
      {
        key: "q0",
        type: "string",
        title: "Deploy",
        description: "Should I deploy to production now?",
        options: [
          { value: "Yes", label: "Yes", description: "Deploy now" },
          { value: "No", label: "No", description: "Wait" },
        ],
      },
      {
        key: "q1",
        type: "string",
        title: "Region",
        description: "Which region should receive the deployment?",
        options: [
          { value: "US", label: "US", description: "Deploy to the US" },
          { value: "EU", label: "EU", description: "Deploy to the EU" },
        ],
      },
    ] as FormInfo["fields"]
    const client = {
      session: {
        get: mock(async () => info("ses_blocked", worktree, "Blocked")),
        active: mock(async () => ({ ses_blocked: { type: "running" } })),
        prompt: delivered,
      },
      permission: {
        request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
      },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => ({ location, data: [pending] })) },
    } as unknown as OpenCodeClient

    await expect(prompt({ client, root, state, sessionID: "ses_blocked", text: "Continue" })).rejects.toMatchObject({
      code: "unavailable_session",
      message: expect.stringContaining('sessionID "ses_blocked"'),
    })

    const failure = await prompt({
      client,
      root,
      state,
      sessionID: "ses_blocked",
      text: "Continue",
    }).then(
      () => undefined,
      (error: OrchestrationError) => error,
    )
    expect(failure?.message).toContain('questionID "que_1"')
    expect(failure?.message).toContain('"Deploy"')
    expect(failure?.message).toContain("(options: Yes, No)")
    expect(failure?.message).toContain('"Region"')
    expect(failure?.message).toContain("(options: US, EU)")
    expect(failure?.message).toContain("one label array per question in that request (2 total)")
    expect(delivered).not.toHaveBeenCalled()
  })

  it("fails closed when pending blocker state cannot be read", async () => {
    const managed = state.addWorktree({ branch: "fix/blocker-error", path: worktree, parentBranch: "main" })
    state.addSession("ses_blocker_error", managed.id)
    const client = {
      session: { get: mock(async () => info("ses_blocker_error", worktree, "Blocker error")) },
      permission: {
        request: {
          list: mock(async () => {
            throw new Error("offline")
          }),
        },
      },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await expect(
      prompt({ client, root, state, sessionID: "ses_blocker_error", text: "Continue" }),
    ).rejects.toMatchObject({
      code: "host_error",
      message: "The managed session blockers could not be read",
    } satisfies Partial<OrchestrationError>)
  })

  it("rejects unknown, stale, and cross-workspace targets", async () => {
    const managed = state.addWorktree({ branch: "fix/errors", path: worktree, parentBranch: "main" })
    state.addSession("ses_target", managed.id)
    const delivered = mock(async () => undefined)
    const client = {
      session: {
        get: mock(async () => info("ses_target", root, "Target")),
        active: mock(async () => ({})),
        prompt: delivered,
      },
      permission: {
        request: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
      },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)) },
    } as unknown as OpenCodeClient

    await expect(prompt({ client, root, state, sessionID: "ses_unknown", text: "Continue" })).rejects.toMatchObject({
      code: "unknown_session",
    } satisfies Partial<OrchestrationError>)
    await expect(
      prompt({
        client,
        root,
        state,
        sessionID: "ses_unknown",
        text: "Continue",
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
        managed: { id: "ses_foreign", worktreeId: "wt_foreign", createdAt: "" },
      }),
    ).rejects.toMatchObject({ code: "stale_session" } satisfies Partial<OrchestrationError>)
    await expect(prompt({ client, root, state, sessionID: "ses_target", text: "Continue" })).rejects.toMatchObject({
      code: "cross_workspace",
    } satisfies Partial<OrchestrationError>)

    fs.rmSync(worktree, { recursive: true, force: true })
    await expect(prompt({ client, root, state, sessionID: "ses_target", text: "Continue" })).rejects.toMatchObject({
      code: "stale_session",
    } satisfies Partial<OrchestrationError>)
    expect(delivered).not.toHaveBeenCalled()
  })

  it("answers the sole pending question without a question ID", async () => {
    const managed = state.addWorktree({ branch: "fix/answer", path: worktree, parentBranch: "main" })
    state.addSession("ses_ask", managed.id)
    const replied = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => info("ses_ask", worktree, "Ask")), form: { reply: replied } },
      form: {
        list: mock(async ({ location }: { location: { directory: string } }) => ({
          location,
          data: [form("que_solo", "ses_ask", {})],
        })),
      },
    } as unknown as OpenCodeClient

    const resolved = await answer({ client, root, state, sessionID: "ses_ask", answers: [["Yes"]] })

    expect(resolved).toEqual({ questionID: "que_solo" })
    expect(replied).toHaveBeenCalledWith({ sessionID: "ses_ask", formID: "que_solo", answer: { q0: "Yes" } })
  })

  it("requires a question ID when several are pending and validates answers per question", async () => {
    const managed = state.addWorktree({ branch: "fix/answer-many", path: worktree, parentBranch: "main" })
    state.addSession("ses_many", managed.id)
    const replied = mock(async () => undefined)
    const pending = [
      form("que_a", "ses_many", { title: "A", description: "First?" }),
      form("que_b", "ses_many", { title: "B", description: "Second?" }),
    ]
    const client = {
      session: { get: mock(async () => info("ses_many", worktree, "Many")), form: { reply: replied } },
      form: { list: mock(async ({ location }: { location: { directory: string } }) => ({ location, data: pending })) },
    } as unknown as OpenCodeClient

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
    expect(replied).toHaveBeenCalledWith({ sessionID: "ses_many", formID: "que_b", answer: { q0: "go" } })
  })

  it("rejects answering when nothing or something foreign is pending", async () => {
    const managed = state.addWorktree({ branch: "fix/answer-none", path: worktree, parentBranch: "main" })
    state.addSession("ses_none", managed.id)
    const replied = mock(async () => undefined)
    const client = {
      session: { get: mock(async () => info("ses_none", worktree, "None")), form: { reply: replied } },
      form: {
        list: mock(async ({ location }: { location: { directory: string } }) => ({
          location,
          data: [form("que_other", "ses_stranger", {})],
        })),
      },
    } as unknown as OpenCodeClient

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
    expect(replied).not.toHaveBeenCalled()
  })
})