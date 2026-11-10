import { describe, expect, test } from "bun:test"
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageAssistantText,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client"
import { capacity, historyAction, previewText, promptItems, railEntries } from "../webview-ui/src/v2/prompt-rail-data"
import type { TranscriptQueuedRow } from "../webview-ui/src/v2/transcript"
import { transcriptRows } from "../webview-ui/src/v2/transcript"

const base = { time: { created: 1 } }

const user = (id: string, text: string, extra: Partial<SessionMessageUser> = {}): SessionMessageUser => ({
  ...base,
  id,
  type: "user",
  text,
  ...extra,
})

const text = (value: string): SessionMessageAssistantText => ({ type: "text", text: value })

const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  ...base,
  id,
  type: "assistant",
  agent: "code",
  model: { providerID: "kilo", id: "kilo-auto/free" },
  content,
  time: { created: 1, completed: 2 },
  finish: "stop",
})

const tool: SessionMessageAssistant["content"][number] = {
  type: "tool",
  id: "call",
  name: "bash",
  time: { created: 1 },
  state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
}

const rows = (messages: SessionMessageInfo[]) => transcriptRows(messages)

const queued = (
  id: string,
  value: string,
  metadata?: SessionInboxUser["payload"]["metadata"],
): TranscriptQueuedRow => ({
  key: `queued:${id}`,
  item: {
    id,
    sessionID: "session",
    time: { created: 1 },
    type: "user",
    payload: { text: value, metadata },
    delivery: "queue",
  } satisfies SessionInboxUser,
})

describe("previewText", () => {
  test("collapses whitespace and keeps plain text", () => {
    expect(previewText("  hello\n\nworld  ")).toBe("hello world")
  })

  test("drops fenced code blocks and inline code", () => {
    expect(previewText("before `const x = 1` after\n```\nconst y = 2\n```\nend")).toBe("before after end")
  })

  test("keeps link labels but drops URLs and images", () => {
    expect(previewText("see [the docs](https://example.com) and ![shot](img.png) now")).toBe("see the docs and now")
  })

  test("keeps bracket text inside inline code literal", () => {
    expect(previewText("echo `[label](url)` verbatim")).toBe("echo verbatim")
  })

  test("strips heading, list, and quote markers", () => {
    expect(previewText("# Title\n- one\n> two\nthree")).toBe("Title one two three")
  })
})

describe("promptItems", () => {
  test("emits one item per user prompt with its answer", () => {
    const items = promptItems(
      rows([
        user("u1", "add authentication"),
        assistant("a1", [text("Done, auth is wired up.")]),
        user("u2", "now fix the bug"),
        assistant("a2", [text("Fixed it.")]),
      ]),
    )

    expect(items).toEqual([
      { key: "u1:user", turn: "u1", queued: false, prompt: "add authentication", answer: "Done, auth is wired up." },
      { key: "u2:user", turn: "u2", queued: false, prompt: "now fix the bug", answer: "Fixed it." },
    ])
  })

  test("keeps assistant chunks of one turn joined in order", () => {
    const content = Array.from({ length: 10 }, (_, index) => text(`Step ${index + 1}.`))
    const items = promptItems(rows([user("u1", "go"), assistant("a1", content)]))

    expect(items[0]?.answer).toBe(content.map((part) => part.text).join(" "))
  })

  test("keeps each steered prompt with the answer that followed it", () => {
    const items = promptItems(
      rows([
        user("u1", "first"),
        assistant("a1", [text("First answer.")]),
        user("u2", "steer"),
        assistant("a2", [text("Second answer.")]),
        { id: "idle", type: "idle", time: { created: 3 }, outcome: "succeeded" },
      ]),
    )

    expect(items.map((item) => ({ prompt: item.prompt, answer: item.answer }))).toEqual([
      { prompt: "first", answer: "First answer." },
      { prompt: "steer", answer: "Second answer." },
    ])
    expect(items.map((item) => item.turn)).toEqual(["u1", "u1"])
  })

  test("uses the first step with text and keeps all of its chunks", () => {
    const content = Array.from({ length: 10 }, (_, index) => text(`Part ${index + 1}.`))
    const items = promptItems(
      rows([user("u1", "go"), assistant("a1", [tool]), assistant("a2", content), assistant("a3", [text("Later.")])]),
    )

    expect(items[0]?.answer).toBe(content.map((part) => part.text).join(" "))
  })

  test("leaves an empty answer for tool-only turns", () => {
    const items = promptItems(rows([user("u1", "run it"), assistant("a1", [tool, text("   ")])]))

    expect(items[0]).toMatchObject({ prompt: "run it", answer: "" })
  })

  test("truncates long prompts and answers", () => {
    const [item] = promptItems(rows([user("u1", "x".repeat(400)), assistant("a1", [text("y".repeat(400))])]))

    expect(item!.prompt.length).toBe(160)
    expect(item!.prompt.endsWith("…")).toBe(true)
    expect(item!.answer.length).toBe(220)
    expect(item!.answer.endsWith("…")).toBe(true)
  })

  test("promotes the answer when the prompt carries no text (image-only message)", () => {
    const [item] = promptItems(
      rows([
        user("u1", "", {
          files: [{ mime: "image/png", data: "", source: { type: "inline" } }],
        }),
        assistant("a1", [text("That screenshot shows the rail overlapping the gutter.")]),
      ]),
    )

    expect(item).toMatchObject({
      prompt: "That screenshot shows the rail overlapping the gutter.",
      answer: "",
    })
  })

  test("leaves both empty when neither prompt nor answer has text", () => {
    expect(promptItems(rows([user("u1", "")]))[0]).toMatchObject({ prompt: "", answer: "" })
  })

  test("appends queued prompts as marked items", () => {
    const items = promptItems(rows([user("u1", "Start")]), [queued("q1", "Follow up")])

    expect(items.map((item) => ({ key: item.key, queued: item.queued, prompt: item.prompt }))).toEqual([
      { key: "u1:user", queued: false, prompt: "Start" },
      { key: "queued:q1", queued: true, prompt: "Follow up" },
    ])
  })

  test("names a prompt Kilo composed instead of the template it expanded to", () => {
    const [item] = promptItems(
      rows([
        user("u1", "Run the project checks for the current worktree.\n\nTarget: unit", {
          metadata: { kilo: { injected: { title: "/check unit" } } },
        }),
      ]),
    )

    expect(item!.prompt).toBe("Sent by Kilo · /check unit")
  })

  test("keeps a prompt another session delivered and names its origin", () => {
    const [item] = promptItems(
      rows([user("u1", "Please review the diff in this worktree.\n\n<!-- kilo-agent-manager source=ses_1 -->")]),
    )

    expect(item!.prompt).toBe("Sent by Kilo from another session: Please review the diff in this worktree.")
  })

  test("names a queued prompt Kilo composed too", () => {
    const metadata = { kilo: { injected: { title: "/review staged" } } }
    const items = promptItems(rows([]), [queued("q1", "You are Kilo Code, an expert code reviewer.", metadata)])

    expect(items[0]?.prompt).toBe("Sent by Kilo · /review staged")
  })
})

describe("capacity", () => {
  test("counts how many ticks fit the transcript height", () => {
    expect(capacity(24 + 7 * 5)).toBe(5)
    expect(capacity(31)).toBe(1)
  })

  test("fits far more ticks than the navigator lists rows", () => {
    expect(capacity(724)).toBe(100)
  })

  test("returns nothing usable for unmeasured or tiny transcripts", () => {
    expect(capacity(0)).toBeLessThan(1)
    expect(capacity(30)).toBeLessThan(1)
  })
})

describe("historyAction", () => {
  test("loads the next page only after the previous page made progress", () => {
    expect(historyAction(80, 160, true)).toBe("load")
  })

  test("jumps after the final page", () => {
    expect(historyAction(160, 200, false)).toBe("jump")
  })

  test("stops instead of retrying a page that made no progress", () => {
    expect(historyAction(160, 160, true)).toBe("stop")
  })
})

describe("railEntries", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({
    key: `k${index}`,
    turn: `t${index}`,
    queued: false,
    prompt: `p${index}`,
    answer: `a${index}`,
  }))

  test("passes through when everything fits", () => {
    expect(railEntries(items, 5)).toEqual(items.map((item, index) => ({ type: "prompt", item, index })))
    expect(railEntries(items, 10)).toEqual(items.map((item, index) => ({ type: "prompt", item, index })))
  })

  test("keeps the first and latest prompts at minimal capacity", () => {
    expect(railEntries(items, 2)).toEqual([
      { type: "prompt", item: items[0], index: 0 },
      { type: "prompt", item: items[4], index: 4 },
    ])
  })

  test("summarizes hidden loaded prompts between the first and recent prompts", () => {
    expect(railEntries(items, 4)).toEqual([
      { type: "prompt", item: items[0], index: 0 },
      { type: "overflow", count: 2, index: 1 },
      { type: "prompt", item: items[3], index: 3 },
      { type: "prompt", item: items[4], index: 4 },
    ])
  })

  test("reserves the first entry for unloaded history", () => {
    expect(railEntries(items, 4, true)).toEqual([
      { type: "history" },
      { type: "overflow", count: 3, index: 0 },
      { type: "prompt", item: items[3], index: 3 },
      { type: "prompt", item: items[4], index: 4 },
    ])
  })

  test("returns nothing at zero capacity", () => {
    expect(railEntries(items, 0)).toEqual([])
  })
})
