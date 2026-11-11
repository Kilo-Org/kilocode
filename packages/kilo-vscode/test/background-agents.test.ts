import { describe, expect, it } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import {
  jobAgents,
  mergeListed,
  mergePromptAgents,
  runChildren,
  showBackgroundAgent,
  stackFit,
  stackPlace,
  subagentBackground,
  transcriptAgents,
  transcriptChildren,
  upsertJob,
  type BackgroundJob,
} from "../webview-ui/src/components/chat/background-agents"

type Options = {
  id?: string
  child?: string
  description?: string
  agent?: string
  background?: boolean
  status?: "running" | "completed"
  /** The tool metadata status: "running" on a completed part means the child went to the background. */
  state?: "running" | "completed"
}

function part(opts: Options = {}): SessionMessageAssistantTool {
  const input = {
    description: opts.description ?? "Research meaning of life",
    agent: opts.agent ?? "general",
    prompt: "go",
    ...(opts.background === undefined ? {} : { background: opts.background }),
  }
  const metadata = {
    ...(opts.child === undefined ? {} : { sessionID: opts.child }),
    status: opts.state ?? "running",
  }
  const state: SessionMessageAssistantTool["state"] =
    opts.status === "completed"
      ? { status: "completed", input, metadata, content: [{ type: "text", text: "done" }] }
      : { status: "running", input, metadata }
  return { type: "tool", id: opts.id ?? "call_1", name: "subagent", state, time: { created: 1 } }
}

function assistant(id: string, parts: SessionMessageAssistantTool[]) {
  return { type: "assistant", id, content: parts } as unknown as SessionMessageInfo
}

function user(id: string) {
  return { type: "user", id, text: "hi", time: { created: 1 } } as unknown as SessionMessageInfo
}

function job(id: string, input: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id,
    parentSessionID: "parent",
    sessionID: id,
    title: id,
    status: "running",
    background: true,
    time: { started: 1 },
    ...input,
  } as BackgroundJob
}

const never = () => false

describe("subagent children", () => {
  it("lists each child once in spawn order", () => {
    const messages = [
      assistant("m1", [part({ id: "a", child: "ses_a" }), part({ id: "b", child: "ses_b", background: true })]),
      assistant("m2", [part({ id: "c", child: "ses_a" })]),
    ]

    expect(transcriptChildren(messages)).toEqual(["ses_a", "ses_b"])
  })

  it("ignores other tools and parts without a child session", () => {
    const shell = { type: "tool", id: "s", name: "shell", state: { status: "running", input: {}, metadata: {} } }
    const messages = [assistant("m1", [shell as SessionMessageAssistantTool, part({ id: "x" })])]

    expect(transcriptChildren(messages)).toEqual([])
  })

  it("lists only the children the current run started", () => {
    const messages = [
      assistant("m1", [part({ id: "a", child: "ses_old" })]),
      user("u2"),
      assistant("m3", [part({ id: "b", child: "ses_new" })]),
    ]

    expect(runChildren(messages)).toEqual(["ses_new"])
  })

  it("reads background from the input or from a completed part whose child still runs", () => {
    expect(subagentBackground(part({ child: "a", background: true }))).toBe(true)
    expect(subagentBackground(part({ child: "a" }))).toBe(false)
    expect(subagentBackground(part({ child: "a", status: "completed", state: "running" }))).toBe(true)
    expect(subagentBackground(part({ child: "a", status: "completed", state: "completed" }))).toBe(false)
  })
})

describe("transcriptAgents", () => {
  const running = (ids: string[]) => (id: string) => ids.includes(id)

  it("lists a running background agent", () => {
    const messages = [assistant("m1", [part({ child: "ses_child", background: true, description: "Audit deps" })])]

    expect(transcriptAgents(messages, running(["ses_child"]), never)).toEqual([
      {
        id: "ses_child",
        description: "Audit deps",
        agent: "general",
        status: "running",
        startedAt: 1,
        waiting: false,
      },
    ])
  })

  it("ignores foreground subagents and children that no longer run", () => {
    const messages = [
      assistant("m1", [part({ id: "a", child: "ses_a" }), part({ id: "b", child: "ses_b", background: true })]),
    ]

    expect(transcriptAgents(messages, running(["ses_a"]), never)).toEqual([])
  })

  it("does not list a child after a later foreground resume", () => {
    const messages = [
      assistant("m1", [part({ id: "a", child: "ses_a", background: true })]),
      assistant("m2", [part({ id: "b", child: "ses_a", background: false })]),
    ]

    expect(transcriptAgents(messages, running(["ses_a"]), never)).toEqual([])
  })

  it("falls back to no description when the input has none", () => {
    const messages = [assistant("m1", [part({ child: "ses_a", background: true, description: "   " })])]

    expect(transcriptAgents(messages, running(["ses_a"]), never).at(0)?.description).toBeUndefined()
  })
})

describe("jobAgents", () => {
  it("keeps every lifecycle state of the owning parent's background jobs", () => {
    const jobs = [
      job("child_1"),
      job("child_2", { status: "completed", time: { started: 2, completed: 3 } }),
      job("child_3", { status: "cancelled" }),
      job("child_4", { status: "error", error: "failed" }),
      job("child_5", { parentSessionID: "other" } as Partial<BackgroundJob>),
      job("child_6", { background: false }),
    ]

    expect(jobAgents(jobs, "parent", never)).toMatchObject([
      { id: "child_1", status: "running" },
      { id: "child_2", status: "completed", finishedAt: 3 },
      { id: "child_3", status: "cancelled" },
      { id: "child_4", status: "error", error: "failed" },
    ])
  })

  it("marks a running child that waits for the user", () => {
    const rows = jobAgents([job("one"), job("two"), job("done", { status: "completed" })], "parent", (id) =>
      ["two", "done"].includes(id),
    )

    expect(rows.map((row) => row.waiting)).toEqual([false, true, false])
  })

  it("shows a running job after its earlier result was cleared", () => {
    const agent = jobAgents([job("child")], "parent", never)[0]!
    const hidden = new Set(["child"])

    expect(showBackgroundAgent(agent, hidden)).toBe(true)
    expect(showBackgroundAgent({ ...agent, status: "completed" }, hidden)).toBe(false)
  })
})

describe("job list", () => {
  it("replaces a job by ID and appends a new one", () => {
    const first = upsertJob([], job("a"))
    const next = upsertJob(upsertJob(first, job("b")), job("a", { status: "completed" }))

    expect(next.map((item) => [item.id, item.status])).toEqual([
      ["a", "completed"],
      ["b", "running"],
    ])
  })

  it("keeps the event version of a job that changed while the list was in flight", () => {
    const current = [job("a", { status: "completed" }), job("late")]
    const listed = [job("a"), job("b")]

    expect(mergeListed(listed, current, new Set(["a", "late"])).map((item) => [item.id, item.status])).toEqual([
      ["a", "completed"],
      ["b", "running"],
      ["late", "running"],
    ])
  })
})

describe("mergePromptAgents", () => {
  const live = (id: string, description?: string) => ({
    id,
    description,
    agent: "general",
    status: "running" as const,
    startedAt: 0,
    waiting: false,
  })

  it("appends new agents and keeps the existing order", () => {
    const first = mergePromptAgents([], [live("ses_a")])
    const next = mergePromptAgents(first, [live("ses_b"), live("ses_a")])

    expect(next.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(next.every((item) => !item.done)).toBe(true)
  })

  it("keeps the same object for an unchanged running agent", () => {
    const prev = mergePromptAgents([], [live("ses_a", "Task")])

    expect(mergePromptAgents(prev, [live("ses_a", "Task")]).at(0)).toBe(prev.at(0))
  })

  it("marks agents that stop running as done instead of removing them", () => {
    const prev = mergePromptAgents([], [live("ses_a"), live("ses_b")])

    expect(mergePromptAgents(prev, [live("ses_b")])).toMatchObject([
      { id: "ses_a", done: true },
      { id: "ses_b", done: false },
    ])
  })

  it("revives a done agent that runs again and refreshes its label", () => {
    const prev = mergePromptAgents(mergePromptAgents([], [live("ses_a", "Old")]), [])

    expect(mergePromptAgents(prev, [live("ses_a", "New")])).toEqual([
      { id: "ses_a", description: "New", agent: "general", done: false },
    ])
  })
})

describe("stackFit", () => {
  it("shows up to three avatars when there is room", () => {
    expect(stackFit(500, 10)).toBe(3)
    expect(stackFit(500, 2)).toBe(2)
  })

  it("drops avatars before it overflows and keeps at least one", () => {
    // Three avatars and "+7" need 90px, two avatars and "+8" need 69px.
    expect(stackFit(90, 10)).toBe(3)
    expect(stackFit(89, 10)).toBe(2)
    expect(stackFit(68, 10)).toBe(1)
    expect(stackFit(0, 10)).toBe(1)
  })
})

describe("stackPlace", () => {
  it("leads the first line when it has room", () => {
    expect(stackPlace([200, 150], 263, 45)).toEqual({ line: 0, end: false })
    expect(stackPlace([], 263, 45)).toEqual({ line: 0, end: false })
  })

  it("ends the first later line with room instead of adding a line", () => {
    expect(stackPlace([240, 180], 263, 45)).toEqual({ line: 1, end: true })
    expect(stackPlace([240, 250, 100], 263, 45)).toEqual({ line: 2, end: true })
  })

  it("leads and lets the row wrap when no line has room", () => {
    expect(stackPlace([240, 250], 263, 45)).toEqual({ line: 0, end: false })
  })
})
