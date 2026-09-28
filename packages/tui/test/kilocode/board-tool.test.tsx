import { expect, test } from "bun:test"
import type { ToolPart } from "@kilocode/sdk/v2"
import { testRender } from "@opentui/solid"
import { CodeRenderable, type Renderable } from "@opentui/core"
import { onMount } from "solid-js"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { BoardTool } from "../../src/kilocode/board-tool"
import { BlockTool, toolDisplay } from "../../src/routes/session"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const message = {
  from: "main",
  to: "ses_helper12345678",
  fromLabel: "Release investigation",
  toLabel: "Inspect publish timeout",
  type: "INFO",
  body: "The **larger package** succeeded.\n\nCheck the timeout setting next.",
}

function part(tool: string, output: unknown, metadata: Record<string, unknown> = {}): ToolPart {
  return {
    id: "prt_board",
    sessionID: "ses_board",
    messageID: "msg_board",
    callID: "call_board",
    type: "tool",
    tool,
    state: {
      status: "completed",
      input: { to: message.to, type: message.type, body: message.body },
      output: typeof output === "string" ? output : JSON.stringify(output),
      title: "Shared agent board",
      metadata,
      time: { start: 1, end: 2 },
    },
  }
}

function Fixture(props: { part: ToolPart; ready: () => void }) {
  onMount(props.ready)
  return <BoardTool part={props.part} block={BlockTool} conceal />
}

async function highlight(node: Renderable) {
  if (node instanceof CodeRenderable) await node.highlightingDone
  await Promise.all(node.getChildren().map(highlight))
}

async function render(part: ToolPart, width = 100) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const config = createTuiResolvedConfig()
  const ready = Promise.withResolvers<void>()
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: tmp.path }}>
        <KVProvider>
          <TuiConfigProvider config={config}>
            <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
              <Fixture part={part} ready={() => ready.resolve()} />
            </ThemeProvider>
          </TuiConfigProvider>
        </KVProvider>
      </TestTuiContexts>
    ),
    { width, height: 40 },
  )
  try {
    await ready.promise
    await app.flush()
    await highlight(app.renderer.root)
    await app.flush()
    return app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/^┃/, "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  } finally {
    app.renderer.destroy()
  }
}

test("board tools use dedicated renderers", () => {
  expect(toolDisplay("board_post")).toBe("board_post")
  expect(toolDisplay("board_read")).toBe("board_read")
  expect(toolDisplay("plugin_tool")).toBe("generic")
})

test("posts show labelled routes, markdown bodies, receipts, and approval notes", async () => {
  const frame = await render(
    part("board_post", message, {
      approval: { source: "agent", agent: "code", rule: { permission: "board_post", pattern: "*", action: "allow" } },
    }),
  )
  expect(frame).toContain("INFO · Release investigation → Inspect publish timeout")
  expect(frame).toContain("The larger package succeeded.")
  expect(frame).toContain("Check the timeout setting next.")
  expect(frame).toContain("Stored only. Delivery and reading are not confirmed.")
  expect(frame).toContain("auto-approved by the code agent")
  expect(frame).not.toContain('"body":')
})

test("post headers prefer metadata labels and preserve availability warnings", async () => {
  const warning = "No other recipients were active at this post attempt."
  const frame = await render(
    part("board_post", { ...message, warning }, { fromLabel: "Coordinator", toLabel: "Worker" }),
  )
  expect(frame).toContain("Coordinator → Worker")
  expect(frame).toContain(warning)
})

test("reads show all message routes, broadcasts, and pagination without a post receipt", async () => {
  const frame = await render(
    part("board_read", {
      messages: [message, { from: message.to, to: "ALL", type: "RESULT", body: "Timeout confirmed." }],
      hasMore: true,
    }),
  )
  expect(frame).toContain("Shared agent board (2 messages)")
  expect(frame).toContain("Release investigation → Inspect publish timeout")
  expect(frame).toContain("RESULT · Agent · 12345678 → All agents")
  expect(frame).toContain("Timeout confirmed.")
  expect(frame).toContain("More messages are available.")
  expect(frame).not.toContain("Stored only")
})

test("empty reads show an explicit empty state", async () => {
  const frame = await render(part("board_read", { messages: [] }))
  expect(frame).toContain("Shared agent board (0 messages)")
  expect(frame).toContain("No messages on the board.")
})

test.each(["unparsed board output", { messages: [{ body: "Incomplete message" }] }])(
  "malformed responses preserve the output: %j",
  async (output) => {
    const frame = await render(part("board_read", output))
    expect(frame).toContain(typeof output === "string" ? output : JSON.stringify(output))
    expect(frame).not.toContain("No messages on the board")
    expect(frame).not.toContain("Stored only")
  },
)

test("failed posts retain the body and error without claiming storage", async () => {
  const value = part("board_post", message)
  value.state = { status: "error", input: value.state.input, error: "Permission denied", time: { start: 1, end: 2 } }
  const frame = await render(value)
  expect(frame).toContain("Check the timeout setting next.")
  expect(frame).toContain("Permission denied")
  expect(frame).not.toContain("Stored only")
})

test("pending posts show their input without claiming storage", async () => {
  const value = part("board_post", message)
  value.state = { status: "pending", input: value.state.input, raw: "" }
  const frame = await render(value)
  expect(frame).toContain("Check the timeout setting next.")
  expect(frame).not.toContain("Stored only")
})

test("message bodies wrap in narrow terminals", async () => {
  const frame = await render(
    part("board_post", {
      from: "main",
      to: "ALL",
      type: "INFO",
      body: "A message that must wrap without losing any words at the end.",
    }),
    40,
  )
  expect(frame).toContain("Primary agent → All agents")
  expect(frame).toContain("A message that must wrap without losing any words at the end.")
  expect(frame).toContain("Stored only. Delivery and reading are not confirmed.")
})
