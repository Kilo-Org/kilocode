import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { timelineBars } from "../webview-ui/src/utils/timeline/bars"
import { color, label, palette } from "../webview-ui/src/utils/timeline/colors"
import { formatCompactCount } from "../webview-ui/src/utils/format"
import { geometry, hit, navigate } from "../webview-ui/src/utils/timeline/geometry"
import { same } from "../webview-ui/src/utils/timeline/highlight"
import { partKey, renderable, timelineParts } from "../webview-ui/src/utils/timeline/timeline-parts"
import { MAX_HEIGHT, pinned, sizes } from "../webview-ui/src/utils/timeline/sizes"
import type { TimelinePart } from "../webview-ui/src/utils/timeline/types"

const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageInfo => ({
  id,
  type: "assistant",
  time: { created: 1 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
})

const user: SessionMessageInfo = { id: "user-1", type: "user", text: "hello", time: { created: 0 } }

type Tool = Extract<SessionMessageAssistant["content"][number], { type: "tool" }>

const tool = (id: string, name: string, state: Tool["state"]): Tool => ({
  type: "tool",
  id,
  name,
  time: { created: 1 },
  state,
})

describe("timelineParts", () => {
  test("uses a tool id and a message index as the part key", () => {
    const read: Tool = {
      type: "tool",
      id: "call-1",
      name: "read",
      time: { created: 1 },
      state: { status: "running", input: { path: "a.ts" }, metadata: {} },
    }
    expect(partKey("a1", { type: "text", text: "hello" }, 0)).toBe("a1:0")
    expect(partKey("a1", { type: "reasoning", text: "why", time: { created: 1 } }, 2)).toBe("a1:2")
    expect(partKey("a1", read, 1)).toBe("call-1")
  })

  test("matches the timeline filter without building parts", () => {
    expect(renderable({ type: "text", text: "  " })).toBe(false)
    expect(renderable({ type: "reasoning", text: "[REDACTED]", time: { created: 1 } })).toBe(false)
    expect(renderable(tool("t1", "todowrite", { status: "running", input: {}, metadata: {} }))).toBe(false)
    expect(renderable(tool("t2", "read", { status: "running", input: {}, metadata: {} }))).toBe(true)
  })

  test("walks assistant messages in order and keys parts like the transcript", () => {
    const parts = timelineParts([
      user,
      assistant("a1", [
        { type: "text", text: "first" },
        {
          type: "tool",
          id: "call-1",
          name: "read",
          time: { created: 1 },
          state: { status: "running", input: { path: "a.ts" }, metadata: {} },
        },
        { type: "reasoning", text: "why", time: { created: 1 } },
      ]),
      assistant("a2", [{ type: "text", text: "second" }]),
    ])

    expect(parts.map((part) => [part.type, part.key, part.messageID])).toEqual([
      ["text", "a1:0", "a1"],
      ["tool", "call-1", "a1"],
      ["reasoning", "a1:2", "a1"],
      ["text", "a2:0", "a2"],
    ])
  })

  test("drops blank text and reasoning that is only redacted", () => {
    const parts = timelineParts([
      assistant("a1", [
        { type: "text", text: "   " },
        { type: "reasoning", text: "[REDACTED]", time: { created: 1 } },
        { type: "reasoning", text: "[REDACTED] stays", time: { created: 1 } },
      ]),
    ])

    expect(parts).toEqual([{ type: "reasoning", key: "a1:2", messageID: "a1", text: "[REDACTED] stays" }])
  })

  test("shows todowrite and todoread only when completed", () => {
    const parts = timelineParts([
      assistant("a1", [
        tool("todo-1", "todowrite", { status: "running", input: { todos: [] }, metadata: {} }),
        tool("todo-2", "todoread", { status: "streaming", input: "{}" }),
        tool("todo-3", "todowrite", {
          status: "completed",
          input: { todos: [] },
          content: [{ type: "text", text: "done" }],
        }),
      ]),
    ])

    expect(parts.map((part) => part.key)).toEqual(["todo-3"])
  })

  test("keeps the raw input while a tool streams", () => {
    const [part] = timelineParts([
      assistant("a1", [tool("call-1", "read", { status: "streaming", input: '{"path":' })]),
    ])

    expect(part).toEqual({
      type: "tool",
      key: "call-1",
      messageID: "a1",
      name: "read",
      status: "streaming",
      input: '{"path":',
      output: "",
    })
  })

  test("joins the text content of a completed tool", () => {
    const [part] = timelineParts([
      assistant("a1", [
        tool("call-1", "read", {
          status: "completed",
          input: { path: "a.ts" },
          content: [
            { type: "text", text: "first" },
            { type: "file", uri: "file:///a.png", mime: "image/png" },
            { type: "text", text: "second" },
          ],
        }),
      ]),
    ])

    expect(part?.type === "tool" && part.output).toBe("first\nsecond")
  })
})

describe("sizes", () => {
  const text = (value: string): TimelinePart => ({ type: "text", key: "k", messageID: "m", text: value })

  test("bounds bar heights between the minimum and MAX_HEIGHT minus padding", () => {
    const [short, long] = sizes([text("a"), text("a".repeat(100))])

    expect(MAX_HEIGHT).toBe(26)
    expect(short!.width).toBe(12)
    expect(short!.height).toBe(8)
    expect(long!.height).toBe(MAX_HEIGHT - 4)
    expect(long!.height).toBeGreaterThan(short!.height)
  })

  test("scales proportionally and keeps the minimum for empty content", () => {
    const bar = sizes([text("a".repeat(10)), text("a".repeat(20)), text("a".repeat(5))])

    expect(bar[0]!.content).toBe(10)
    expect(bar[1]!.content).toBe(20)
    expect(bar[1]!.height).toBeGreaterThan(bar[0]!.height)
    expect(bar[2]!.height).toBe(12)
    expect(sizes([text(""), text("a")])[0]!.height).toBe(8)
    expect(sizes([])).toEqual([])
  })

  test("counts tool input and output as content", () => {
    const [part] = sizes([
      {
        type: "tool",
        key: "call-1",
        messageID: "a1",
        name: "read",
        status: "completed",
        input: { path: "a.ts" },
        output: "12345",
      },
    ])

    expect(part!.content).toBeGreaterThan(5)
  })

  test("pins only near the right edge", () => {
    expect(pinned({ scrollLeft: 100, scrollWidth: 500, clientWidth: 388 })).toBe(true)
    expect(pinned({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toBe(false)
    expect(pinned({ scrollLeft: 88, scrollWidth: 500, clientWidth: 400 }, 12)).toBe(true)
  })
})

describe("timelineBars", () => {
  type ToolPart = Extract<TimelinePart, { type: "tool" }>

  const part = (overrides: Partial<ToolPart>): ToolPart => ({
    type: "tool",
    key: "call",
    messageID: "m",
    name: "read",
    status: "completed",
    input: {},
    output: "",
    ...overrides,
  })

  test("uses the palette and label for each part kind", () => {
    const bars = timelineBars([
      part({ name: "read" }),
      part({ name: "edit" }),
      part({ name: "shell", status: "error" }),
      part({ name: "shell" }),
      { type: "text", key: "m:0", messageID: "m", text: "hi" },
      { type: "reasoning", key: "m:1", messageID: "m", text: "why" },
    ])

    expect(bars.map((bar) => bar.bg)).toEqual([
      palette.read,
      palette.write,
      palette.error,
      palette.tool,
      palette.text,
      palette.reasoning,
    ])
    expect(bars.map((bar) => bar.tip)).toEqual(["read", "edit", "shell", "shell", "Text", "Reasoning"])
    expect(bars.map((bar) => bar.idx)).toEqual([0, 1, 2, 3, 4, 5])
    expect(bars[0]).toMatchObject({ msgId: "m", partId: "call", width: 12 })
  })

  test("color and label expose the frozen helpers", () => {
    expect(color(part({ name: "glob" }))).toBe(palette.read)
    expect(label(part({ name: "write" }))).toBe("write")
  })
})

describe("geometry", () => {
  test("groups paths by color and lays out the bars", () => {
    const layout = geometry(
      [
        { bg: "a", width: 12, height: 10 },
        { bg: "a", width: 12, height: 20 },
        { bg: "b", width: 12, height: 6 },
      ],
      MAX_HEIGHT,
    )

    expect(layout.paths.map((path) => path.bg)).toEqual(["a", "b"])
    expect(layout.paths[0]!.d.split("M").length - 1).toBe(2)
    expect(layout.items.map((item) => item.x)).toEqual([0, 13, 26])
    expect(layout.width).toBe(39)
  })

  test("hits inside a bar and misses the gap", () => {
    const { items } = geometry(
      [
        { bg: "a", width: 12, height: 10 },
        { bg: "b", width: 12, height: 10 },
      ],
      MAX_HEIGHT,
    )

    expect(hit(items, 0)).toBe(0)
    expect(hit(items, 11)).toBe(0)
    expect(hit(items, 12)).toBe(-1)
    expect(hit(items, 13)).toBe(1)
    expect(hit(items, 24)).toBe(1)
    expect(hit(items, 25)).toBe(-1)
  })

  test("navigates with Home, End and the arrows", () => {
    expect(navigate(1, 3, "Home")).toBe(0)
    expect(navigate(1, 3, "End")).toBe(2)
    expect(navigate(1, 3, "ArrowLeft")).toBe(0)
    expect(navigate(0, 3, "ArrowLeft")).toBe(0)
    expect(navigate(1, 3, "ArrowRight")).toBe(2)
    expect(navigate(2, 3, "ArrowRight")).toBe(2)
    expect(navigate(-1, 3, "ArrowLeft")).toBe(2)
    expect(navigate(-1, 3, "ArrowRight")).toBe(0)
    expect(navigate(1, 3, "x")).toBe(1)
    expect(navigate(0, 0, "End")).toBe(-1)
  })
})

describe("highlight", () => {
  test("compares the message and part of two highlights", () => {
    expect(same(undefined, undefined)).toBe(true)
    expect(same({ msgId: "m", partId: "p" }, { msgId: "m", partId: "p" })).toBe(true)
    expect(same({ msgId: "m", partId: "p" }, { msgId: "m", partId: "q" })).toBe(false)
    expect(same({ msgId: "m", partId: "p" }, undefined)).toBe(false)
  })
})

describe("formatCompactCount", () => {
  test("formats below one thousand as plain digits", () => {
    expect(formatCompactCount(0)).toBe("0")
    expect(formatCompactCount(999)).toBe("999")
  })

  test("formats thousands with one decimal", () => {
    expect(formatCompactCount(1_000)).toBe("1.0K")
    expect(formatCompactCount(1_500)).toBe("1.5K")
    expect(formatCompactCount(999_949)).toBe("999.9K")
  })

  test("switches to millions at the rounding boundary", () => {
    expect(formatCompactCount(999_950)).toBe("1.0M")
    expect(formatCompactCount(1_000_000)).toBe("1.0M")
    expect(formatCompactCount(1_234_567)).toBe("1.2M")
  })
})
