import { describe, expect, it } from "bun:test"
import { messageTurns } from "../../webview-ui/src/context/session-queue"
import { transcriptRows } from "../../webview-ui/src/context/transcript-rows"
import type { Message, Part, TextPart } from "../../webview-ui/src/types/messages"
import { capacity, previewText, promptItems, railItems } from "../../webview-ui/src/components/chat/prompt-rail"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string, opts: Partial<Message> = {}): Message => ({ ...base, id, role: "user", ...opts })
const assistant = (id: string, parentID: string, opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  parentID,
  role: "assistant",
  ...opts,
})
const text = (id: string, messageID: string, value: string, opts: Partial<TextPart> = {}): Part => ({
  id,
  messageID,
  type: "text",
  text: value,
  ...opts,
})
const tool = (id: string, messageID: string, title: string): Part => ({
  id,
  messageID,
  type: "tool",
  tool: "bash",
  state: { status: "completed", input: {}, output: "", title },
})
const lookup = (values: Record<string, Part[]>) => (id: string) => values[id] ?? []

describe("previewText", () => {
  it("collapses whitespace and keeps plain text", () => {
    expect(previewText("  hello\n\nworld  ")).toBe("hello world")
  })

  it("drops fenced code blocks and inline code", () => {
    expect(previewText("before `const x = 1` after\n```\nconst y = 2\n```\nend")).toBe("before after end")
  })

  it("keeps link labels but drops URLs and images", () => {
    expect(previewText("see [the docs](https://example.com) and ![shot](img.png) now")).toBe("see the docs and now")
  })

  it("keeps bracket text inside inline code literal", () => {
    expect(previewText("echo `[label](url)` verbatim")).toBe("echo verbatim")
  })

  it("strips heading, list, and quote markers", () => {
    expect(previewText("# Title\n- one\n> two\nthree")).toBe("Title one two three")
  })
})

describe("promptItems", () => {
  it("emits one item per non-partial user turn with prompt and answer", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const parts = {
      u1: [text("up1", "u1", "add authentication")],
      a1: [text("ap1", "a1", "Done, auth is wired up.")],
      u2: [text("up2", "u2", "now fix the bug")],
      a2: [text("ap2", "a2", "Fixed it.")],
    }
    const rows = transcriptRows(messageTurns([u1, a1, u2, a2]), lookup(parts))

    const items = promptItems(rows)

    expect(items).toEqual([
      { key: "u1:user", turn: "u1", queued: false, prompt: "add authentication", answer: "Done, auth is wired up." },
      { key: "u2:user", turn: "u2", queued: false, prompt: "now fix the bug", answer: "Fixed it." },
    ])
  })

  it("keeps assistant chunks of one turn joined", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = {
      u1: [text("up1", "u1", "go")],
      a1: [text("ap1", "a1", "First."), text("ap2", "a1", "Second.")],
    }
    const rows = transcriptRows(messageTurns([u1, a1]), lookup(parts))

    expect(promptItems(rows)[0]?.answer).toBe("First. Second.")
  })

  it("skips synthetic parts and leaves an empty answer for tool-only turns", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = {
      u1: [text("up1", "u1", "run it"), text("up2", "u1", "internal", { synthetic: true })],
      a1: [tool("at1", "a1", "Run tests"), text("at2", "a1", "hidden", { synthetic: true })],
    }
    const rows = transcriptRows(messageTurns([u1, a1]), lookup(parts))

    expect(promptItems(rows)[0]).toMatchObject({ prompt: "run it", answer: "" })
  })

  it("marks queued rows", () => {
    const u1 = user("u1")
    const u2 = user("u2")
    const rows = transcriptRows(messageTurns([u1, u2]), lookup({}), { queued: new Set(["u2"]) })

    expect(promptItems(rows).map((item) => item.queued)).toEqual([false, true])
  })

  it("truncates long prompts and answers", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = {
      u1: [text("up1", "u1", "x".repeat(400))],
      a1: [text("ap1", "a1", "y".repeat(400))],
    }
    const rows = transcriptRows(messageTurns([u1, a1]), lookup(parts))

    const [item] = promptItems(rows)
    expect(item!.prompt.length).toBe(160)
    expect(item!.prompt.endsWith("…")).toBe(true)
    expect(item!.answer.length).toBe(220)
    expect(item!.answer.endsWith("…")).toBe(true)
  })

  it("omits partial turns (assistant-only leads)", () => {
    const a1 = assistant("a1", "u1")
    const rows = transcriptRows(messageTurns([a1]), lookup({ a1: [text("p1", "a1", "hello")] }))

    expect(promptItems(rows)).toEqual([])
  })

  it("promotes the answer when the prompt carries no text (image-only message)", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = {
      u1: [{ id: "up1", messageID: "u1", type: "file", mime: "image/png", url: "data:," } as Part],
      a1: [text("ap1", "a1", "That screenshot shows the rail overlapping the gutter.")],
    }
    const rows = transcriptRows(messageTurns([u1, a1]), lookup(parts))

    expect(promptItems(rows)[0]).toMatchObject({
      prompt: "That screenshot shows the rail overlapping the gutter.",
      answer: "",
    })
  })

  it("leaves both empty when neither prompt nor answer has text", () => {
    const u1 = user("u1")
    const rows = transcriptRows(messageTurns([u1]), lookup({}))

    expect(promptItems(rows)[0]).toMatchObject({ prompt: "", answer: "" })
  })
})

describe("capacity", () => {
  it("counts how many worst-case rows fit the transcript height", () => {
    expect(capacity(24 + 76 * 5)).toBe(5)
    expect(capacity(100)).toBe(1)
  })

  it("returns nothing usable for unmeasured or tiny transcripts", () => {
    expect(capacity(0)).toBeLessThan(1)
    expect(capacity(99)).toBeLessThan(1)
  })
})

describe("railItems", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    key: `k${i}`,
    turn: `t${i}`,
    queued: false,
    prompt: `p${i}`,
    answer: `a${i}`,
  }))

  it("passes through when everything fits", () => {
    expect(railItems(items, 5)).toEqual(items)
    expect(railItems(items, 10)).toEqual(items)
  })

  it("keeps the newest items when capacity is smaller", () => {
    expect(railItems(items, 2)).toEqual(items.slice(-2))
  })

  it("returns nothing at zero capacity", () => {
    expect(railItems(items, 0)).toEqual([])
  })
})
