import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { board, presentation, recipient, transcript } from "../../webview-ui/src/components/chat/board-tool"
import { scanScope } from "../../webview-ui/src/components/chat/transcript-search-highlight"

const note = {
  id: "board_one",
  timestamp: 1788273600000,
  from: "ses_research",
  to: "main",
  type: "RESULT",
  body: "Keep cancellation intact.\nRun the focused tests.",
}

const read = {
  agent: "main",
  participants: [{ id: "ses_research", label: "Research" }],
  messages: [note],
  cursor: note.id,
  hasMore: true,
}

const t: Parameters<typeof presentation>[3] = (key, params) => [key, ...Object.values(params ?? {})].join(":")

describe("board communication", () => {
  it("identifies completed reads and the shared destination", () => {
    const view = presentation("board_read", board("board_read", {}, JSON.stringify(read)), true, t)
    expect(view.title).toBe("tool.board.message:1")
    expect(view.subtitle).toBe("tool.board.channel")
    expect(view.from(note.from)).toBe("tool.board.from:Research")
    expect(view.to(note.to)).toBe("tool.board.to:tool.board.main")
    expect(view.receipt).toBeUndefined()
  })

  it("cleans task suffixes only for display and prefers cached renamed titles", () => {
    const title = "Review cancellation (@swarm-probe subagent)"
    const data = board("board_read", {}, JSON.stringify({ ...read, participants: [{ id: note.from, label: title }] }))
    const info = { title, parentID: "ses_root" }
    const lookup = (id: string) => (id === note.from ? info : undefined)
    const incoming = presentation("board_read", data, true, t, lookup)
    const posted = board("board_post", {}, JSON.stringify({ ...note, to: note.from }))
    const outgoing = presentation("board_post", posted, true, t, lookup)
    expect(presentation("board_read", data, true, t).from(note.from)).toBe("tool.board.from:Review cancellation")
    expect(incoming.from(note.from)).toBe("tool.board.from:Review cancellation")
    expect(outgoing.to(note.from)).toBe("tool.board.to:Review cancellation")
    expect(outgoing.title).toBe("tool.board.posted:Review cancellation")
    expect(info.title).toBe(title)
    info.title = "Review cancellation (renamed)"
    expect(incoming.from(note.from)).toBe("tool.board.from:Review cancellation (renamed)")
    expect(presentation("board_post", posted, true, t, lookup).title).toBe(
      "tool.board.posted:Review cancellation (renamed)",
    )
    info.title = `${title} follow-up`
    expect(incoming.from(note.from)).toBe(`tool.board.from:${title} follow-up`)
    expect(data.names.get(note.from)).toBe(title)
  })

  it("recognizes a cached root session without inventing identities for missing sessions", () => {
    const lookup = (id: string) => (id === "ses_root" ? { title: "Current task" } : undefined)
    const view = presentation(
      "board_post",
      board("board_post", {}, JSON.stringify({ ...note, from: "ses_root" })),
      true,
      t,
      lookup,
    )
    expect(view.from("ses_root")).toBe("tool.board.from:tool.board.main")
    expect(view.from("ses_missing")).toBe("tool.board.from:tool.board.agent:missing")
    const partial = presentation("board_post", board("board_post", {}), true, t, () => ({}))
    expect(partial.from("ses_partial")).toBe("tool.board.from:tool.board.agent:partial")
  })

  it("does not claim a pending read completed", () => {
    const view = presentation("board_read", board("board_read", {}), false, t)
    expect(view.title).toBe("tool.board.read")
    expect(view.empty).toBeUndefined()
    expect(view.subtitle).toBeUndefined()
  })

  it("keeps posts without recipient fields as stored, not read", () => {
    const view = presentation("board_post", board("board_post", {}, JSON.stringify(note)), true, t)
    expect(view.title).toBe("tool.board.posted:tool.board.main")
    expect(view.receipt).toBe("tool.board.receipt")
    expect(view.status).toBeUndefined()
  })

  it("keeps a legacy inactive-recipient status separate from the message", () => {
    const output = JSON.stringify({ ...note, warning: "Stored only; resume the task to request work." })
    const view = presentation("board_post", board("board_post", {}, output), true, t)
    expect(view.title).toBe("tool.board.saved:tool.board.main")
    expect(view.status).toBe("tool.board.inactive")
    expect(view.receipt).toBe("tool.board.receipt")
    expect(view.messages.at(0)?.body).toBe(note.body)
    expect(transcript(view).indexOf(note.body)).toBeLessThan(transcript(view).indexOf(view.status!))
  })

  it.each([
    ["main", "tool.board.main"],
    ["ALL", "tool.board.all"],
    [note.from, "tool.board.agent:research"],
  ])("describes the inactive audience without claiming %s is inactive", (to, label) => {
    const view = presentation(
      "board_post",
      board(
        "board_post",
        {},
        JSON.stringify({ ...note, to, delivery: "stored", recipients: { state: "inactive", observedAt: 1 } }),
      ),
      true,
      t,
    )
    expect(view.title).toBe(`tool.board.saved:${label}`)
    expect(view.status).toBe("tool.board.audience")
    expect(view.receipt).toBe("tool.board.receipt")
  })

  it.each([
    ["active", "tool.board.posted", undefined],
    ["inactive", "tool.board.saved", "tool.board.audience"],
    ["unknown", "tool.board.posted", "tool.board.unknown"],
  ])("prefers %s recipient state over a legacy inactive warning", (state, title, status) => {
    const output = JSON.stringify({
      ...note,
      delivery: "stored",
      recipients: { state, observedAt: 1 },
      warning: "Stored only; resume the task to request work.",
    })
    const view = presentation("board_post", board("board_post", {}, output), true, t)
    expect(view.title).toBe(`${title}:tool.board.main`)
    expect(view.status).toBe(status)
    expect(view.receipt).toBe("tool.board.receipt")
  })

  it("does not infer inactivity from an unrelated warning", () => {
    const output = JSON.stringify({ ...note, warning: "Additional delivery information." })
    const view = presentation("board_post", board("board_post", {}, output), true, t)
    expect(view.status).toBe("tool.board.status:Additional delivery information.")
    expect(view.title).toBe("tool.board.posted:tool.board.main")
  })

  it("indexes only the visible recipient for a pending post", () => {
    const view = presentation("board_post", board("board_post", { to: "main", body: note.body }), false, t)
    const chunks = transcript(view)
    expect(view.title).toBe("tool.board.post")
    expect(view.receipt).toBeUndefined()
    expect(chunks.filter((chunk) => chunk.includes("tool.board.main"))).toHaveLength(1)
  })

  it("does not highlight secondary controls as message matches", () => {
    const window = new Window()
    const saved = { document: globalThis.document, Text: globalThis.Text, NodeFilter: globalThis.NodeFilter }
    Object.assign(globalThis, { document: window.document, Text: window.Text, NodeFilter: window.NodeFilter })
    try {
      const element = window.document.createElement("div")
      element.innerHTML =
        "<p>Keep cancellation intact.</p>\n<div data-search-ignore><button>Keep details</button></div>"
      const ranges = scanScope(element as unknown as HTMLElement, /Keep/g)
      expect(ranges.map((range) => range.toString())).toEqual(["Keep"])
    } finally {
      Object.assign(globalThis, saved)
      void window.happyDOM.close()
    }
  })

  it("indexes each message once without protocol kinds or internal IDs", () => {
    const view = presentation("board_read", board("board_read", {}, JSON.stringify(read)), true, t)
    const chunks = transcript(view)
    expect(chunks.filter((chunk) => chunk === note.body)).toHaveLength(1)
    expect(chunks).not.toContain(note.type)
    expect(chunks.join(" ")).not.toContain(note.id)
  })
})

describe("board tool presentation", () => {
  it("extracts readable messages without internal identifiers or timestamps", () => {
    const result = board("board_read", { limit: 20 }, JSON.stringify(read))
    expect(result.messages).toEqual([{ from: note.from, to: note.to, type: note.type, body: note.body }])
    expect(result.names.get(note.from)).toBe("Research")
    expect(result.more).toBe(true)
    expect(result.raw).toBeUndefined()
  })

  it("uses participant descriptions and real session aliases when provided", () => {
    const data = board(
      "board_read",
      {},
      JSON.stringify({
        ...read,
        participants: [
          { id: "main", sessionID: "ses_root", label: "main" },
          { id: "ses_research", sessionID: "ses_research", label: "explore", description: "Check cancellation" },
        ],
      }),
    )
    const view = presentation("board_read", data, true, t)
    expect(view.from("ses_research")).toBe("tool.board.from:Check cancellation")
    expect(view.from("ses_root")).toBe("tool.board.from:tool.board.main")
  })

  it("uses the posted result rather than duplicating the input body", () => {
    const result = board("board_post", { ...note, body: "Unsent draft" }, JSON.stringify(note))
    expect(result.messages).toHaveLength(1)
    expect(result.messages.at(0)?.body).toBe(note.body)
  })

  it("preserves stored-only warnings", () => {
    const warning = "Stored only; resume the task to request work."
    expect(board("board_post", {}, JSON.stringify({ ...note, warning })).warning).toBe(warning)
  })

  it("shows a pending post without inventing a sender or claiming delivery", () => {
    const result = board("board_post", { to: "ALL", type: "INFO", body: "Checking the tests." })
    expect(result.messages).toEqual([{ to: "ALL", type: "INFO", body: "Checking the tests.", from: undefined }])
    expect(result.warning).toBeUndefined()
  })

  it("handles an empty board", () => {
    expect(board("board_read", {}, JSON.stringify({ messages: [], hasMore: false })).messages).toEqual([])
    expect(board("board_read", {})).toMatchObject({ messages: [], valid: false })
  })

  it.each(["not JSON", "null", "[]", '{"messages":[null]}', '{"messages":[{"body":42}]}'])(
    "preserves unexpected output for inspection: %s",
    (raw) => {
      expect(board("board_read", {}, raw)).toMatchObject({ messages: [], raw })
    },
  )

  it("keeps all returned messages and names available for search", () => {
    const result = board(
      "board_read",
      {},
      JSON.stringify({
        messages: Array.from({ length: 100 }, () => note),
        participants: Array.from({ length: 100 }, (_, i) => ({ id: `ses_${i}`, label: `Agent ${i}` })),
      }),
    )
    expect(result.messages).toHaveLength(100)
    expect(result.names.size).toBe(100)
    expect(result.more).toBe(false)
    expect(transcript(presentation("board_read", result, true, t)).filter((chunk) => chunk === note.body)).toHaveLength(
      100,
    )
  })

  it("reuses parsed output until it changes", () => {
    const input = { limit: 20 }
    const output = JSON.stringify(read)
    const initial = board("board_read", input, output)
    expect(board("board_read", input, output)).toBe(initial)
    expect(board("board_read", input, JSON.stringify({ messages: [] }))).not.toBe(initial)
  })

  it.each([undefined, "not JSON", '{"messages":[null]}'])("does not claim incomplete output was read: %s", (output) => {
    const view = presentation("board_read", board("board_read", {}, output), true, t)
    expect(view.title).toBe("tool.board.read")
    expect(view.unavailable).toBe("tool.board.unavailable")
    expect(view.empty).toBeUndefined()
    expect(transcript(view)).not.toContain(output)
  })

  it("preserves message text literally", () => {
    const body = '<img src="x" onerror="alert(1)">\n`code` and ${text}'
    expect(board("board_post", {}, JSON.stringify({ ...note, body })).messages.at(0)?.body).toBe(body)
  })

  it("resolves known names and shortens opaque IDs without inventing identity", () => {
    const labels = { main: "Main", all: "All agents", agent: (id: string) => `Agent ${id}` }
    const names = new Map([
      ["ses_research", "Research"],
      ["ses_root", "main"],
    ])
    expect(recipient("main", names, labels)).toBe("Main")
    expect(recipient("ALL", names, labels)).toBe("All agents")
    expect(recipient("ses_research", names, labels)).toBe("Research")
    expect(recipient("ses_root", names, labels)).toBe("Main")
    expect(recipient("ses_abcdefgh1234", names, labels)).toBe("Agent abcd…1234")
  })
})
