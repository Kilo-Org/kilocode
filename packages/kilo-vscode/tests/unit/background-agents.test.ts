import { describe, expect, it } from "bun:test"
import {
  backgroundAgents,
  backgroundJobAgents,
  showBackgroundAgent,
} from "../../webview-ui/src/components/chat/background-agents"
import { childForeground, showChildPromotion } from "../../webview-ui/src/components/chat/task-tool-state"
import { latestTaskPart } from "../../webview-ui/src/context/session-utils"
import type {
  BackgroundJobInfo,
  PermissionRequest,
  QuestionRequest,
  SessionStatusInfo,
  ToolPart,
} from "../../webview-ui/src/types/messages"

interface TaskOptions {
  id?: string
  child?: string
  description?: string
  agent?: string
  background?: boolean
  /** Put the metadata on the part instead of the tool state. */
  onPart?: boolean
  status?: "pending" | "running" | "completed"
}

function taskPart(opts: TaskOptions = {}): ToolPart {
  const metadata: Record<string, unknown> = {}
  if (opts.child !== undefined) metadata.sessionId = opts.child
  if (opts.background !== undefined) metadata.background = opts.background
  const input = {
    description: opts.description ?? "Research meaning of life",
    subagent_type: opts.agent ?? "general",
  }
  const state =
    opts.status === "completed"
      ? { status: "completed" as const, input, output: "done", title: "task" }
      : { status: (opts.status ?? "running") as "pending" | "running", input }
  return {
    id: opts.id ?? "part_1",
    type: "tool",
    tool: "task",
    state: opts.onPart ? state : { ...state, metadata },
    metadata: opts.onPart ? metadata : undefined,
  } as ToolPart
}

const busy: SessionStatusInfo = { type: "busy" }
const idle: SessionStatusInfo = { type: "idle" }

describe("backgroundAgents", () => {
  it("lists a running background agent from tool state metadata", () => {
    const tools = [taskPart({ child: "ses_child", background: true, description: "Audit deps", agent: "explore" })]

    expect(backgroundAgents(tools, { ses_child: busy })).toEqual([
      {
        id: "ses_child",
        description: "Audit deps",
        agent: "explore",
        status: "running",
        startedAt: 0,
        jobID: "ses_child",
      },
    ])
  })

  it("reads metadata from the part when the state has none", () => {
    const tools = [taskPart({ child: "ses_child", background: true, onPart: true })]

    expect(backgroundAgents(tools, { ses_child: busy }).map((a) => a.id)).toEqual(["ses_child"])
  })

  it("ignores foreground subagents", () => {
    expect(backgroundAgents([taskPart({ child: "ses_child" })], { ses_child: busy })).toEqual([])
  })

  it("identifies each parallel foreground child independently", () => {
    const status = { ses_a: busy, ses_b: busy }

    expect(childForeground("ses_a", {}, {}, status, true)).toBe(true)
    expect(childForeground("ses_b", {}, {}, status, true)).toBe(true)
    expect(childForeground("ses_a", { background: true }, {}, status, true)).toBe(false)
    expect(childForeground("ses_b", {}, { background: true }, status, true)).toBe(false)
    expect(childForeground("ses_a", {}, {}, { ses_a: idle }, true)).toBe(false)
    expect(
      childForeground("ses_a", {}, {}, { ses_a: { type: "retry", attempt: 1, message: "retry", next: 1 } }, true),
    ).toBe(true)
    expect(childForeground(undefined, {}, {}, status, true)).toBe(false)
    expect(childForeground("ses_a", {}, {}, status, false)).toBe(false)
    expect(showChildPromotion("ses_a", {}, {}, status, true, false, true)).toBe(true)
    expect(showChildPromotion("ses_a", {}, {}, status, true, true, true)).toBe(false)
    expect(showChildPromotion("ses_a", {}, {}, status, false, false, true)).toBe(false)
    expect(showChildPromotion("ses_a", {}, {}, status, undefined, false, true)).toBe(false)
  })

  it("only promotes the latest task part for a resumed child", () => {
    const parts = [
      taskPart({ id: "part_old", child: "ses_a" }),
      taskPart({ id: "part_new", child: "ses_a" }),
      taskPart({ id: "part_other", child: "ses_b" }),
    ]

    expect(latestTaskPart("part_old", "ses_a", parts)).toBe(false)
    expect(latestTaskPart("part_new", "ses_a", parts)).toBe(true)
    expect(latestTaskPart("part_other", "ses_b", parts)).toBe(true)
  })

  it("ignores agents whose session is no longer working", () => {
    const tools = [taskPart({ child: "ses_child", background: true })]

    expect(backgroundAgents(tools, { ses_child: idle })).toEqual([])
  })

  it("ignores agents with no status yet, so stale parts cannot show a spinner", () => {
    const tools = [taskPart({ child: "ses_child", background: true })]

    expect(backgroundAgents(tools, {})).toEqual([])
  })

  it("keeps retrying agents visible", () => {
    const tools = [taskPart({ child: "ses_child", background: true })]
    const retry: SessionStatusInfo = { type: "retry", attempt: 1, message: "rate limited", next: 1000 }

    expect(backgroundAgents(tools, { ses_child: retry }).map((a) => a.id)).toEqual(["ses_child"])
  })

  it("lists several parallel agents in transcript order", () => {
    const tools = [
      taskPart({ id: "part_1", child: "ses_a", background: true, description: "A" }),
      taskPart({ id: "part_2", child: "ses_b", background: true, description: "B" }),
      taskPart({ id: "part_3", child: "ses_c", background: true, description: "C" }),
    ]
    const status = { ses_a: busy, ses_b: busy, ses_c: busy }

    expect(backgroundAgents(tools, status).map((a) => a.description)).toEqual(["A", "B", "C"])
  })

  it("deduplicates repeated parts for the same child session", () => {
    const tools = [
      taskPart({ id: "part_1", child: "ses_a", background: true }),
      taskPart({ id: "part_2", child: "ses_a", background: true }),
    ]

    expect(backgroundAgents(tools, { ses_a: busy })).toHaveLength(1)
  })

  it("does not list a child after a later foreground resume", () => {
    const tools = [
      taskPart({ id: "part_1", child: "ses_a", background: true }),
      taskPart({ id: "part_2", child: "ses_a", background: false }),
    ]

    expect(backgroundAgents(tools, { ses_a: busy })).toEqual([])
  })

  it("ignores tools other than task", () => {
    const bash = { id: "part_2", type: "tool", tool: "bash", state: { status: "running", input: {} } } as ToolPart

    expect(backgroundAgents([bash], { ses_child: busy })).toEqual([])
  })

  it("falls back to no description when the input has none", () => {
    const part = taskPart({ child: "ses_child", background: true })
    const state = part.state as { input: Record<string, unknown> }
    state.input.description = "   "

    expect(backgroundAgents([part], { ses_child: busy })).toEqual([
      {
        id: "ses_child",
        description: undefined,
        agent: "general",
        status: "running",
        startedAt: 0,
        jobID: "ses_child",
      },
    ])
  })

  it("keeps agents listed while the task part is still pending", () => {
    const tools = [taskPart({ child: "ses_child", background: true, status: "pending" })]

    expect(backgroundAgents(tools, { ses_child: busy }).map((a) => a.id)).toEqual(["ses_child"])
  })

  it("preserves all backend lifecycle states for the owning parent", () => {
    const jobs: BackgroundJobInfo[] = [
      {
        id: "job_running",
        type: "task",
        title: "Running",
        status: "running",
        started_at: 1,
        metadata: { parentSessionId: "parent", sessionId: "child_1", background: true },
      },
      {
        id: "job_done",
        type: "task",
        title: "Done",
        status: "completed",
        started_at: 2,
        completed_at: 3,
        metadata: { parentSessionId: "parent", sessionId: "child_2", background: true },
      },
      {
        id: "job_cancelled",
        type: "task",
        title: "Cancelled",
        status: "cancelled",
        started_at: 4,
        completed_at: 5,
        metadata: { parentSessionId: "parent", sessionId: "child_3", background: true },
      },
      {
        id: "job_error",
        type: "task",
        title: "Error",
        status: "error",
        started_at: 6,
        completed_at: 7,
        error: "failed",
        metadata: { parentSessionId: "parent", sessionId: "child_4", background: true },
      },
      {
        id: "job_other",
        type: "task",
        title: "Other parent",
        status: "running",
        started_at: 8,
        metadata: { parentSessionId: "other", sessionId: "child_5", background: true },
      },
    ]

    expect(backgroundJobAgents(jobs, "parent")).toMatchObject([
      { id: "child_1", status: "running" },
      { id: "child_2", status: "completed" },
      { id: "child_3", status: "cancelled" },
      { id: "child_4", status: "error", error: "failed" },
    ])
  })

  it("attributes child attention requests to the matching background row", () => {
    const jobs: BackgroundJobInfo[] = [
      {
        id: "job_one",
        type: "task",
        title: "One",
        status: "running",
        started_at: 1,
        metadata: { parentSessionId: "parent", sessionId: "child_one", background: true },
      },
      {
        id: "job_two",
        type: "task",
        title: "Two",
        status: "running",
        started_at: 2,
        metadata: { parentSessionId: "parent", sessionId: "child_two", background: true },
      },
    ]
    const permission = { id: "permission", sessionID: "child_two" } as PermissionRequest
    const question = { id: "question", sessionID: "child_one" } as QuestionRequest
    const rows = backgroundJobAgents(jobs, "parent", [permission], [question])

    expect(rows[0]?.question?.id).toBe("question")
    expect(rows[1]?.permission?.id).toBe("permission")
  })

  it("keeps attention state on a running row for collapsed summaries", () => {
    const jobs: BackgroundJobInfo[] = [
      {
        id: "job_waiting",
        type: "task",
        title: "Waiting",
        status: "running",
        started_at: 1,
        metadata: { parentSessionId: "parent", sessionId: "child", background: true },
      },
    ]
    const rows = backgroundJobAgents(jobs, "parent", [], [{ id: "question", sessionID: "child" } as QuestionRequest])

    expect(rows.filter((row) => row.question || row.permission)).toHaveLength(1)
  })

  it("shows a restarted running job after its earlier result was dismissed", () => {
    const hidden = new Set(["job"])
    const agent = {
      id: "child",
      status: "running" as const,
      startedAt: 1,
      jobID: "job",
    }

    expect(showBackgroundAgent(agent, hidden)).toBe(true)
    expect(showBackgroundAgent({ ...agent, status: "completed" }, hidden)).toBe(false)
  })
})
