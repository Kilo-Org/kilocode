import { describe, expect, it } from "bun:test"
import type { BackgroundProcessInfo, KiloClient, Part } from "@kilocode/sdk/v2/client"
import { build, load, starts, transcript, transcripts, type Facts } from "../../src/kilo-provider/agent-map"
import { REQUEST, SOURCE, stamp } from "../../src/agent-manager/prompt-attribution"
import { active, count, elapsed, stoppable, total, tree } from "../../webview-ui/src/components/chat/agent-map"
import type { AgentMap, AgentMapNode } from "../../webview-ui/src/types/messages"

type Item = Facts["sessions"][number]

function item(id: string, extra: Partial<Item> = {}): Item {
  return { id, title: id, directory: "/repo", time: { created: 10, updated: 20 }, ...extra }
}

function facts(sessions: Item[], root: string, extra: Partial<Facts> = {}): Facts {
  return { root, sessions, statuses: {}, waiting: new Set(), jobs: [], processes: [], ...extra }
}

function proc(id: string, sessionID: string, extra: Partial<BackgroundProcessInfo> = {}): BackgroundProcessInfo {
  return {
    id,
    sessionID,
    command: `run ${id}`,
    cwd: "/repo",
    ports: [],
    status: "running",
    lifetime: "session",
    ready: true,
    output: "",
    time: { started: 30, updated: 40 },
    ...extra,
  }
}

const ids = (map: AgentMap) => map.nodes.map((node) => node.id)
const node = (map: AgentMap, id: string) => map.nodes.find((entry) => entry.id === id)

describe("agent map build", () => {
  it("lays out the requested session and everything below it", () => {
    const result = build(
      facts(
        [
          item("grandchild", { parentID: "child", time: { created: 30, updated: 40 } }),
          item("root"),
          item("child", { parentID: "root", time: { created: 20, updated: 30 } }),
        ],
        "root",
      ),
    )

    expect(result.map.root).toBe("root")
    expect(ids(result.map)).toEqual(["root", "child", "grandchild"])
    expect(result.map.nodes.map((entry) => [entry.kind, entry.parent])).toEqual([
      ["root", undefined],
      ["task", "root"],
      ["task", "child"],
    ])
  })

  it("roots the map at a subagent and leaves the agents above it out", () => {
    const result = build(
      facts(
        [
          item("root"),
          item("sibling", { parentID: "root" }),
          item("child", { parentID: "root" }),
          item("grandchild", { parentID: "child" }),
        ],
        "child",
        { processes: [proc("p-root", "root"), proc("p-child", "child")] },
      ),
    )

    expect(result.map.root).toBe("child")
    expect(ids(result.map)).toEqual(["child", "grandchild", "p-child"])
    expect(node(result.map, "child")).toMatchObject({ kind: "root", parent: undefined })
  })

  it("orders siblings by start time", () => {
    const result = build(
      facts(
        [
          item("root"),
          item("late", { parentID: "root", time: { created: 50, updated: 60 } }),
          item("early", { parentID: "root", time: { created: 15, updated: 60 } }),
        ],
        "root",
      ),
    )

    expect(ids(result.map)).toEqual(["root", "early", "late"])
  })

  it("hangs Agent Manager sessions under the session whose call started them", () => {
    const result = build(
      facts(
        [
          item("root"),
          item("worktree", { directory: "/repo/.kilo/worktrees/a", metadata: { [SOURCE]: "root" } }),
          item("helper", { parentID: "worktree", directory: "/repo/.kilo/worktrees/a" }),
        ],
        "root",
      ),
    )

    expect(result.map.root).toBe("root")
    expect(node(result.map, "worktree")).toMatchObject({ kind: "session", parent: "root" })
    expect(node(result.map, "helper")).toMatchObject({ kind: "task", parent: "worktree" })
    expect(result.dirs.get("helper")).toBe("/repo/.kilo/worktrees/a")
  })

  it("treats a session whose starter is unknown as the root", () => {
    const result = build(facts([item("orphan", { metadata: { [SOURCE]: "gone" }, parentID: "pruned" })], "orphan"))

    expect(result.map.root).toBe("orphan")
    expect(result.map.nodes).toHaveLength(1)
    expect(node(result.map, "orphan")?.kind).toBe("root")
  })

  it("does not loop on a metadata cycle", () => {
    const result = build(
      facts([item("a", { metadata: { [SOURCE]: "b" } }), item("b", { metadata: { [SOURCE]: "a" } })], "a"),
    )

    expect(ids(result.map).toSorted()).toEqual(["a", "b"])
    expect(result.map.nodes.filter((entry) => entry.kind === "root")).toHaveLength(1)
  })

  it("reads status from session state, attention, and background jobs", () => {
    const result = build(
      facts(
        [
          item("root"),
          item("busy", { parentID: "root" }),
          item("retry", { parentID: "root" }),
          item("asking", { parentID: "root" }),
          item("failed", { parentID: "root" }),
          item("cancelled", { parentID: "root" }),
          item("finished", { parentID: "root" }),
        ],
        "root",
        {
          statuses: {
            busy: { type: "busy" },
            retry: { type: "retry", attempt: 1, message: "rate limited", next: 0 },
            asking: { type: "busy" },
          },
          waiting: new Set(["asking"]),
          jobs: [
            {
              status: "error",
              started_at: 11,
              completed_at: 99,
              metadata: { sessionId: "failed", background: true },
            },
            { status: "cancelled", started_at: 12, completed_at: 50, metadata: { sessionId: "cancelled" } },
          ],
        },
      ),
    )

    const status = Object.fromEntries(result.map.nodes.map((entry) => [entry.id, entry.status]))
    expect(status).toEqual({
      root: "done",
      busy: "running",
      retry: "running",
      asking: "waiting",
      failed: "error",
      cancelled: "cancelled",
      finished: "done",
    })
    expect(node(result.map, "busy")?.finished).toBeUndefined()
    expect(node(result.map, "asking")?.finished).toBeUndefined()
    expect(node(result.map, "failed")).toMatchObject({ background: true, started: 11, finished: 99 })
    expect(node(result.map, "finished")).toMatchObject({ started: 10, finished: 20 })
    expect(node(result.map, "finished")?.background).toBeUndefined()
  })

  it("shows the description of a Task session and keeps its agent and model", () => {
    const result = build(
      facts(
        [
          item("root", { model: { id: "opus", providerID: "kilo", variant: "default" } }),
          item("child", {
            parentID: "root",
            title: "Audit the parser (@explore subagent)",
            agent: "explore",
            model: { id: "haiku", providerID: "kilo", variant: "high" },
            tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
            cost: 0.5,
          }),
        ],
        "root",
      ),
    )

    expect(node(result.map, "root")?.model).toEqual({ providerID: "kilo", modelID: "opus" })
    expect(node(result.map, "child")).toMatchObject({
      title: "Audit the parser",
      agent: "explore",
      model: { providerID: "kilo", modelID: "haiku", variant: "high" },
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      cost: 0.5,
    })
  })

  it("hangs background processes under the session that runs them", () => {
    const result = build(
      facts([item("root"), item("child", { parentID: "root", directory: "/repo/wt" })], "root", {
        processes: [
          proc("p-dev", "child", { description: "Dev server", ports: [5173], pid: 42 }),
          proc("p-ready", "root", { status: "ready", time: { started: 31, updated: 40 } }),
          proc("p-ok", "root", { status: "exited", exitCode: 0, time: { started: 32, updated: 41, ended: 45 } }),
          proc("p-bad", "root", { status: "exited", exitCode: 2, time: { started: 33, updated: 42 } }),
          proc("p-failed", "root", { status: "failed", time: { started: 34, updated: 43 } }),
          proc("p-stopped", "root", { status: "stopped", time: { started: 35, updated: 44 } }),
          proc("p-stranger", "elsewhere"),
        ],
      }),
    )

    expect(node(result.map, "p-dev")).toMatchObject({
      kind: "process",
      parent: "child",
      title: "Dev server",
      command: "run p-dev",
      status: "running",
      pid: 42,
      ports: [5173],
    })
    expect(node(result.map, "p-dev")?.finished).toBeUndefined()
    expect(node(result.map, "p-ready")).toMatchObject({ title: "run p-ready", status: "running" })
    expect(node(result.map, "p-ready")?.ports).toBeUndefined()
    expect(node(result.map, "p-ok")).toMatchObject({ status: "done", finished: 45 })
    expect(node(result.map, "p-bad")).toMatchObject({ status: "error", finished: 42 })
    expect(node(result.map, "p-failed")?.status).toBe("error")
    expect(node(result.map, "p-stopped")?.status).toBe("cancelled")
    expect(node(result.map, "p-stranger")).toBeUndefined()
    // A process is stopped through the backend instance of the session that owns it.
    expect(result.dirs.get("p-dev")).toBe("/repo/wt")
  })

  it("cuts a runaway family at the node limit", () => {
    const kids = Array.from({ length: 250 }, (_, index) => item(`kid-${index}`, { parentID: "root" }))
    const result = build(facts([item("root"), ...kids], "root"))

    expect(result.map.nodes).toHaveLength(200)
    expect(result.map.truncated).toBe(true)
  })

  it("does not mark a map that fits as truncated", () => {
    const result = build(facts([item("root"), item("kid", { parentID: "root" })], "root"))

    expect(result.map.truncated).toBeUndefined()
  })

  it("leaves out what a reverted call started once it has stopped", () => {
    const am = (id: string, request?: string) =>
      item(id, { metadata: { [SOURCE]: "root", ...(request ? { [REQUEST]: request } : {}) } })
    const result = build(
      facts(
        [
          item("root"),
          item("kept", { parentID: "root" }),
          item("undone", { parentID: "root" }),
          item("below", { parentID: "undone" }),
          item("busy", { parentID: "root" }),
          am("session", "am-kept"),
          am("dropped", "am-undone"),
          am("legacy"),
        ],
        "root",
        {
          statuses: { busy: { type: "busy" } },
          processes: [
            proc("p-kept", "root", { status: "exited", exitCode: 0 }),
            proc("p-undone", "root", { status: "exited", exitCode: 0 }),
            proc("p-running", "root"),
            proc("p-handed", "root", { status: "exited", exitCode: 0, lifetime: "parent" }),
            proc("p-unread", "kept", { status: "exited", exitCode: 0 }),
          ],
          calls: new Map([["root", new Set(["kept", "am-kept", "p-kept"])]]),
        },
      ),
    )

    expect(ids(result.map)).toEqual([
      "root",
      "kept",
      "busy",
      "session",
      "legacy",
      "p-kept",
      "p-running",
      "p-handed",
      "p-unread",
    ])
  })

  it("keeps a reverted agent while anything under it still runs", () => {
    const sessions = [
      item("root"),
      item("undone", { parentID: "root" }),
      item("worker", { parentID: "undone" }),
      item("idle", { parentID: "root" }),
    ]
    const calls = new Map([["root", new Set<string>()]])
    const result = build(
      facts(sessions, "root", {
        calls,
        statuses: { worker: { type: "busy" } },
        processes: [proc("server", "idle")],
      }),
    )

    expect(ids(result.map)).toEqual(["root", "undone", "idle", "worker", "server"])
    expect(ids(build(facts(sessions, "root", { calls })).map)).toEqual(["root"])
  })
})

function tool(id: string, name: string, metadata?: Record<string, unknown>, input: Record<string, unknown> = {}): Part {
  const state = metadata
    ? { status: "completed" as const, input, output: "", title: "", metadata, time: { start: 0, end: 1 } }
    : { status: "pending" as const, input, raw: "" }
  return { id, sessionID: "root", messageID: "m", type: "tool", callID: id, tool: name, state }
}

function message(id: string, parts: Part[]) {
  return { info: { id }, parts }
}

/** A client whose transcripts come from `data`, recording each read. */
function reader(data: Record<string, ReturnType<typeof message>[]>, reads: string[] = []) {
  return {
    session: {
      messages: async (input: { sessionID: string }) => {
        reads.push(input.sessionID)
        return { data: data[input.sessionID] ?? [] }
      },
    },
  } as unknown as KiloClient
}

describe("agent map transcripts", () => {
  const messages = [
    message("msg_1", [
      tool("prt_1a", "task", { sessionId: "child" }),
      tool("prt_1b", "agent_manager", { requestID: "am-1" }),
      tool("prt_1c", "background_process", { processID: "proc-1" }, { action: "start" }),
      tool("prt_1d", "task"),
      tool("prt_1e", "read", { sessionId: "not-a-start" }),
      tool("prt_1f", "background_process", { processID: "proc-0" }, { action: "status", id: "proc-0" }),
    ]),
    message("msg_2", [tool("prt_2a", "task", { sessionId: "early" }), tool("prt_2b", "task", { sessionId: "late" })]),
    message("msg_3", [tool("prt_3a", "task", { sessionId: "last" })]),
  ]

  it("collects what each starting call recorded", () => {
    expect(starts(messages)).toEqual(["child", "am-1", "proc-1", "early", "late", "last"])
  })

  it("skips the calls a revert hides, like the chat does", () => {
    expect(starts(messages, { messageID: "msg_2" })).toEqual(["child", "am-1", "proc-1"])
    expect(starts(messages, { messageID: "msg_2", partID: "prt_2b" })).toEqual(["child", "am-1", "proc-1", "early"])
  })

  it("reads a transcript again only when it can hold something new", async () => {
    const reads: string[] = []
    const client = reader({ root: messages }, reads)
    const memo: Parameters<typeof transcript>[4] = new Map()
    const root = item("root")

    expect([...((await transcript(client, root, ["child"], false, memo, 0)) ?? [])]).toContain("child")
    await transcript(client, root, ["child"], false, memo, 0)
    expect(reads).toHaveLength(1)

    // Something the last read did not look for.
    await transcript(client, root, ["child", "pending"], false, memo, 0)
    await transcript(client, root, ["child", "pending"], false, memo, 0)
    expect(reads).toHaveLength(2)

    // While the session runs, a read that lacks something it owns is trusted for a while.
    await transcript(client, root, ["child", "pending"], true, memo, 0)
    await transcript(client, root, ["child", "pending"], true, memo, 9_999)
    expect(reads).toHaveLength(3)
    await transcript(client, root, ["child", "pending"], true, memo, 10_000)
    expect(reads).toHaveLength(4)
    await transcript(client, root, ["child"], true, memo, 60_000)
    expect(reads).toHaveLength(4)

    // A revert changes the session.
    await transcript(client, item("root", { revert: { messageID: "msg_2" } }), ["child"], true, memo, 60_000)
    expect(reads).toHaveLength(5)
  })

  it("leaves the map whole when a transcript cannot be read", async () => {
    const client = { session: { messages: async () => ({ error: "gone" }) } } as unknown as KiloClient

    expect(await transcript(client, item("root"), ["child"], false, new Map())).toBeUndefined()
  })

  it("reads only the transcripts of sessions that own something that stopped", async () => {
    const reads: string[] = []
    const sessions = [
      item("root"),
      item("working", { parentID: "root" }),
      item("asking", { parentID: "root" }),
      item("done", { parentID: "working" }),
    ]
    const live = { statuses: { working: { type: "busy" as const } }, waiting: new Set(["asking"]) }
    const client = reader({ working: [message("msg_1", [tool("prt_1", "task", { sessionId: "done" })])] }, reads)
    const memo = new Map()

    const calls = await transcripts(client, sessions, [proc("server", "root")], live, memo)

    expect(reads).toEqual(["working"])
    expect([...(calls.get("working") ?? [])]).toEqual(["done"])
    expect(memo.has("working")).toBe(true)

    // The cache keeps only the sessions the map still needs.
    await transcripts(client, [item("root")], [], live, memo)
    expect(memo.size).toBe(0)
  })

  it("finds a process a subagent handed to its parent in the subagent's transcript", async () => {
    const sessions = [
      item("root"),
      item("helper", { parentID: "root", time: { created: 10, updated: 50 } }),
      item("later", { parentID: "root", time: { created: 40, updated: 50 } }),
    ]
    const live = { statuses: {}, waiting: new Set<string>() }
    const start = tool("prt_1", "background_process", { processID: "server" }, { action: "start", inherit: true })
    const reads: string[] = []
    const client = reader({ helper: [message("msg_1", [start])] }, reads)
    const server = proc("server", "root", { status: "exited", exitCode: 0, time: { started: 30, updated: 60 } })

    const calls = await transcripts(client, sessions, [server], live, new Map())

    expect(calls.get("root")?.has("server")).toBe(true)
    expect(reads.toSorted()).toEqual(["helper", "root"])
    // Without that call, the process left with the turn that started it.
    const empty = await transcripts(reader({}), sessions, [server], live, new Map())
    expect(empty.get("root")?.has("server")).toBe(false)
  })
})

describe("agent map load", () => {
  /**
   * A backend holding one family. Agent Manager sessions live in a sibling
   * worktree, and the family list also returns sessions of other families.
   */
  function backend() {
    const calls: string[] = []
    const lists: Record<string, unknown>[] = []
    const root = item("root", { time: { created: 100, updated: 200 } })
    const children: Record<string, Item[]> = {
      root: [
        item("child", { parentID: "root", time: { created: 110, updated: 150 } }),
        // Its starting call was reverted.
        item("old", { parentID: "root", time: { created: 105, updated: 130 } }),
      ],
      child: [item("grand", { parentID: "child", time: { created: 120, updated: 190 } })],
    }
    const family = [
      item("am", {
        directory: "/repo-wt",
        metadata: { [SOURCE]: "root", [REQUEST]: "am-1" },
        time: { created: 120, updated: 190 },
      }),
      item("am-kid", {
        directory: "/repo-wt",
        metadata: { [SOURCE]: "am", [REQUEST]: "am-2" },
        time: { created: 130, updated: 160 },
      }),
      item("other", { directory: "/repo-wt", metadata: { [SOURCE]: "elsewhere" } }),
      item("plain", { directory: "/repo-wt" }),
    ]
    const live: Record<
      string,
      { status: Record<string, { type: "busy" }>; permissions: object[]; processes: BackgroundProcessInfo[] }
    > = {
      "/repo": {
        status: { root: { type: "busy" }, grand: { type: "busy" } },
        permissions: [],
        processes: [proc("stray", "stranger")],
      },
      "/repo-wt": {
        status: {},
        permissions: [{ sessionID: "am" }],
        processes: [proc("proc-am", "am", { cwd: "/repo-wt", ports: [5173] })],
      },
    }
    const transcripts: Record<string, ReturnType<typeof message>[]> = {
      root: [message("msg_1", [tool("prt_1", "task", { sessionId: "child" })])],
      am: [message("msg_1", [tool("prt_1", "agent_manager", { requestID: "am-2" })])],
    }
    const jobs: Record<string, object[]> = {
      root: [
        { status: "completed", started_at: 111, completed_at: 150, metadata: { sessionId: "child", background: true } },
      ],
    }
    const client = {
      session: {
        get: async () => ({ data: root }),
        children: async (input: { sessionID: string; directory: string }) => {
          calls.push(`children:${input.sessionID}@${input.directory}`)
          return { data: children[input.sessionID] ?? [] }
        },
        status: async (input: { directory: string }) => {
          calls.push(`status:${input.directory}`)
          return { data: live[input.directory]?.status }
        },
        messages: async (input: { sessionID: string; directory: string }) => {
          calls.push(`messages:${input.sessionID}@${input.directory}`)
          return { data: transcripts[input.sessionID] ?? [] }
        },
      },
      experimental: {
        session: {
          list: async (input: Record<string, unknown>) => {
            lists.push(input)
            return { data: family }
          },
        },
      },
      permission: { list: async (input: { directory: string }) => ({ data: live[input.directory]?.permissions }) },
      question: { list: async () => ({ data: [] }) },
      backgroundProcess: { list: async (input: { directory: string }) => ({ data: live[input.directory]?.processes }) },
      kilocode: {
        backgroundJobs: async (input: { sessionID: string }) => ({ data: jobs[input.sessionID] ?? [] }),
      },
    } as unknown as KiloClient
    return { client, calls, lists }
  }

  it("finds the Task subagents and the Agent Manager sessions the family started", async () => {
    const api = backend()

    const result = await load(api.client, "root", "/repo")

    expect(result.map.nodes.map((entry) => [entry.id, entry.kind, entry.parent, entry.status])).toEqual([
      ["root", "root", undefined, "running"],
      ["child", "task", "root", "done"],
      ["am", "session", "root", "waiting"],
      ["grand", "task", "child", "running"],
      ["am-kid", "session", "am", "done"],
      ["proc-am", "process", "am", "running"],
    ])
    expect(node(result.map, "child")).toMatchObject({ background: true, started: 111, finished: 150 })
    expect(Object.fromEntries(result.dirs)).toEqual({
      root: "/repo",
      child: "/repo",
      am: "/repo-wt",
      grand: "/repo",
      "am-kid": "/repo-wt",
      "proc-am": "/repo-wt",
    })
  })

  it("asks each session in its own directory and each directory once", async () => {
    const api = backend()

    await load(api.client, "root", "/repo")

    expect(api.lists).toMatchObject([{ worktrees: true, roots: true, directory: "/repo", start: 100, limit: 1000 }])
    expect(api.calls.filter((call) => call.startsWith("children:")).toSorted()).toEqual([
      "children:am-kid@/repo-wt",
      "children:am@/repo-wt",
      "children:child@/repo",
      "children:grand@/repo",
      "children:old@/repo",
      "children:root@/repo",
    ])
    expect(api.calls.filter((call) => call.startsWith("status:")).toSorted()).toEqual([
      "status:/repo",
      "status:/repo-wt",
    ])
    // Only the owners of nodes that stopped are read. `child` owns only the running `grand`.
    expect(api.calls.filter((call) => call.startsWith("messages:")).toSorted()).toEqual([
      "messages:am@/repo-wt",
      "messages:root@/repo",
    ])
  })
})

describe("agent map source metadata", () => {
  it("stamps the calling session and its request only when a session is known", () => {
    expect(stamp({ keep: true }, { sessionID: "ses_a", requestID: "am-1" })).toEqual({
      keep: true,
      [SOURCE]: "ses_a",
      [REQUEST]: "am-1",
    })
    expect(stamp({ keep: true }, { sessionID: "ses_a" })).toEqual({ keep: true, [SOURCE]: "ses_a" })
    expect(stamp({ keep: true }, { requestID: "am-1" })).toEqual({ keep: true })
    expect(stamp({ keep: true }, undefined)).toEqual({ keep: true })
  })
})

function entry(id: string, extra: Partial<AgentMapNode> = {}): AgentMapNode {
  return { id, kind: "task", title: id, status: "done", started: 0, ...extra }
}

describe("agent map view helpers", () => {
  it("lists the children of each node reachable from the root", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [
        entry("root", { kind: "root" }),
        entry("a", { parent: "root" }),
        entry("b", { parent: "root" }),
        entry("a1", { parent: "a" }),
        entry("lost", { parent: "missing" }),
      ],
    }

    expect([...tree(map).entries()]).toEqual([
      ["root", ["a", "b"]],
      ["a", ["a1"]],
      ["b", []],
      ["a1", []],
    ])
  })

  it("does not loop on a malformed map", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [entry("root", { kind: "root", parent: "a" }), entry("a", { parent: "root" })],
    }

    expect([...tree(map).entries()]).toEqual([
      ["root", ["a"]],
      ["a", []],
    ])
  })

  it("returns nothing when the root is missing", () => {
    expect(tree({ root: "gone", nodes: [entry("a")] }).size).toBe(0)
  })

  it("keeps running nodes and the finished chain that started them when finished ones hide", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [
        entry("root", { kind: "root" }),
        entry("done", { parent: "root" }),
        entry("lead", { parent: "root" }),
        entry("worker", { parent: "lead", status: "running" }),
        entry("asking", { parent: "root", kind: "session", status: "waiting" }),
        entry("failed", { parent: "asking", status: "error" }),
        entry("server", { parent: "asking", kind: "process", status: "running" }),
      ],
    }

    const keep = active(map)
    expect([...keep].toSorted()).toEqual(["asking", "lead", "root", "server", "worker"])
    expect([...tree(map, keep).entries()]).toEqual([
      ["root", ["lead", "asking"]],
      ["lead", ["worker"]],
      ["asking", ["server"]],
      ["worker", []],
      ["server", []],
    ])
  })

  it("keeps only the root when nothing runs", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [entry("root", { kind: "root" }), entry("a", { parent: "root" }), entry("b", { parent: "a" })],
    }

    expect([...active(map)]).toEqual(["root"])
    expect([...tree(map, active(map)).entries()]).toEqual([["root", []]])
  })

  it("counts agents and processes apart from the root", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [
        entry("root", { kind: "root", status: "running" }),
        entry("a", { parent: "root", status: "running" }),
        entry("b", { parent: "root", kind: "session", status: "waiting" }),
        entry("c", { parent: "root" }),
        entry("p", { parent: "a", kind: "process", status: "running" }),
      ],
    }

    expect(count(map)).toEqual({ agents: 3, processes: 1, running: 3 })
  })

  it("stops only the running agents that no running agent above them stops", () => {
    const map: AgentMap = {
      root: "root",
      nodes: [
        entry("root", { kind: "root", status: "running" }),
        entry("lead", { parent: "root", status: "running" }),
        entry("worker", { parent: "lead", status: "running" }),
        entry("idle", { parent: "root" }),
        entry("deep", { parent: "idle", status: "running" }),
        entry("deeper", { parent: "deep", status: "running" }),
        entry("manager", { parent: "lead", kind: "session", status: "running" }),
        entry("helper", { parent: "manager", status: "running" }),
        entry("server", { parent: "lead", kind: "process", status: "running" }),
      ],
    }

    expect(stoppable(map).map((node) => node.id)).toEqual(["lead", "deep", "manager"])
  })

  it("adds up every token kind", () => {
    expect(total({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } })).toBe(15)
    expect(total(undefined)).toBe(0)
  })

  it("measures a live node up to now and a finished one up to its end", () => {
    expect(elapsed(entry("live", { started: 1_000 }), 4_000)).toBe(3_000)
    expect(elapsed(entry("done", { started: 1_000, finished: 2_500 }), 9_000)).toBe(1_500)
    expect(elapsed(entry("clock", { started: 5_000 }), 4_000)).toBe(0)
  })
})
