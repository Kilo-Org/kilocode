import { afterEach, beforeEach, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { createSignal } from "solid-js"
import { AgentAvatarPalette } from "../src/components/agent-avatar"
import { BoardSessionsProvider } from "../src/context/board-navigation"
import { ContentPart, ToolRegistry } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { mountRich, mountTool, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

const posted = {
  id: "board_1",
  timestamp: 1,
  from: "main",
  to: "ses_helper12345678",
  fromLabel: "Release investigation",
  toLabel: "Inspect publish timeout",
  type: "INFO",
  body: "The **larger package** succeeded.",
  availability: "running",
  receipt: "Stored only.",
}

test("a board post renders its route and stored message", async () => {
  const card = mountTool("board_post", {
    input: { to: posted.to, type: "INFO", body: posted.body },
    metadata: {
      from: posted.from,
      to: posted.to,
      fromLabel: posted.fromLabel,
      toLabel: posted.toLabel,
      type: posted.type,
    },
    partID: "board-post",
    output: JSON.stringify(posted),
    status: "completed",
    forceOpen: true,
  })
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="board-message-body"] strong'))
  expect(card.host.querySelector(".board-route-sender")?.textContent).toBe(posted.fromLabel)
  expect(card.host.querySelector(".board-route-recipient")?.textContent).toBe(posted.toLabel)
  expect(card.host.querySelector('[data-slot="board-message-body"] strong')?.textContent).toBe("larger package")
  expect(card.host.textContent).toContain("Stored only. Delivery and reading are not confirmed.")
})

test("a board read renders every returned message as an inline event", async () => {
  const card = mountTool("board_read", {
    input: {},
    metadata: {},
    partID: "board-read",
    output: JSON.stringify({
      messages: [
        {
          ...posted,
          id: "board_2",
          from: "ses_helper12345678",
          to: "main",
          fromLabel: "Inspect publish timeout",
          toLabel: "Release investigation",
          type: "RESULT",
          body: "Timeout fixed.",
        },
      ],
      cursor: "board_2",
      hasMore: true,
    }),
    status: "completed",
    forceOpen: true,
  })
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="board-message-body"]'))
  expect(card.host.querySelector('[data-slot="basic-tool-tool-title"]')?.textContent).toBe("Read agent messages")
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("1")
  expect(card.host.querySelector('[data-component="board-participant-stack"]')).not.toBeNull()
  expect(card.host.querySelector(".board-route-sender")?.textContent).toBe("Inspect publish timeout")
  expect(card.host.querySelector(".board-route-recipient")?.textContent).toBe("Release investigation")
  expect(card.host.textContent).toContain("Timeout fixed.")
  expect(card.host.textContent).toContain("More messages are available.")
})

test("a streaming board post shows the route its session store already knows", async () => {
  const card = mountRich(() => (
    <BoardSessionsProvider
      sessions={() => [
        { id: "ses_root", title: "Release investigation" },
        { id: "ses_helper12345678", parentID: "ses_root", title: "Inspect publish timeout" },
      ]}
    >
      <BoardPostPreview />
    </BoardSessionsProvider>
  ))
  mounted.push(card)

  await waitFor(() => card.host.querySelector(".board-route-sender"))
  expect(card.host.querySelector(".board-route-sender")?.textContent).toBe("Inspect publish timeout")
  expect(card.host.querySelector(".board-route-recipient")?.textContent).toBe("Release investigation")
  expect(card.host.querySelector('[data-component="board-route"]')?.getAttribute("data-pending")).toBe("true")
})

test("the transcript routes board tool parts to the board card", async () => {
  const opened: string[] = []
  const item: SessionMessageAssistantTool = {
    type: "tool",
    id: "board-part",
    name: "board_post",
    state: {
      status: "completed",
      input: { to: posted.to, type: posted.type, body: posted.body },
      content: [{ type: "text", text: JSON.stringify(posted) }],
      metadata: { from: posted.from, to: posted.to, fromLabel: posted.fromLabel, toLabel: posted.toLabel },
    },
    time: { created: 1, completed: 2 },
  }
  const message: SessionMessageAssistant = {
    id: "board-message",
    type: "assistant",
    time: { created: 1, completed: 2 },
    agent: "default",
    model: { id: "test", providerID: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [item],
  }
  const card = mountRich(() => (
    <ContentPart
      item={item}
      message={message}
      index={0}
      session="ses_helper12345678"
      forceOpen
      actions={{ openSubagent: (id, title) => opened.push(`${id}:${title}`) }}
    />
  ))
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="board-message-body"]'))
  expect(card.host.querySelector('[data-tool="board_post"]')).not.toBeNull()
  expect(card.host.querySelector(".board-route-recipient")?.textContent).toBe(posted.toLabel)
  card.host.querySelector<HTMLElement>('[data-slot="board-route-avatar"]')?.click()
  expect(opened).toEqual([`${posted.to}:${posted.toLabel}`])
})

test("a board post swaps its streamed body for the stored message when the tool completes", async () => {
  const [item, setItem] = createSignal<SessionMessageAssistantTool>({
    type: "tool",
    id: "board-live-part",
    name: "board_post",
    state: {
      status: "running",
      input: { to: posted.to, type: posted.type, body: posted.body },
      metadata: {},
    },
    time: { created: 1 },
  })
  const message: SessionMessageAssistant = {
    id: "board-live-message",
    type: "assistant",
    time: { created: 1 },
    agent: "default",
    model: { id: "test", providerID: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [],
  }
  const card = mountRich(() => <ContentPart item={item()} message={message} index={0} forceOpen />)
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="mcp-section-label"]'))
  expect(card.host.querySelector('[data-slot="board-message-body"]')).toBeNull()

  setItem({
    type: "tool",
    id: "board-live-part",
    name: "board_post",
    state: {
      status: "completed",
      input: { to: posted.to, type: posted.type, body: posted.body },
      content: [{ type: "text", text: JSON.stringify(posted) }],
      metadata: { from: posted.from, to: posted.to, fromLabel: posted.fromLabel, toLabel: posted.toLabel },
    },
    time: { created: 1, completed: 2 },
  })

  await waitFor(() => card.host.querySelector('[data-slot="board-message-body"]'))
  expect(card.host.querySelector(".board-route-sender")?.textContent).toBe(posted.fromLabel)
  expect(card.host.querySelector(".board-route-recipient")?.textContent).toBe(posted.toLabel)
  expect(card.host.querySelector('[data-component="board-messages"]')).not.toBeNull()
})

test("a collapsed board read expands its message events from the chevron", async () => {
  const card = mountTool("board_read", {
    input: {},
    metadata: {},
    partID: "board-read-collapsed",
    output: JSON.stringify({ messages: [posted], cursor: "board_1", hasMore: false }),
    status: "completed",
  })
  mounted.push(card)

  expect(card.host.querySelector('[data-component="board-messages"]')).toBeNull()
  card.host.querySelector<HTMLElement>('[data-slot="collapsible-arrow"]')?.click()
  await waitFor(() => card.host.querySelector('[data-component="board-messages"]'))
  expect(card.host.querySelector('[data-slot="board-message-body"]')?.innerText).toContain("larger package")
})

test("a broadcast board route renders the session's agent identicons", async () => {
  const Renderer = ToolRegistry.render("board_read")
  if (!Renderer) throw new Error("No renderer registered for board_read")
  const card = mountRich(() => (
    <AgentAvatarPalette ids={["ses_helper12345678", "ses_helper87654321"]}>
      <Renderer
        input={{}}
        metadata={{}}
        tool="board_read"
        partID="board-read-identicons"
        output={JSON.stringify({
          messages: [
            {
              ...posted,
              from: "main",
              to: "ALL",
              fromLabel: "Primary agent",
              toLabel: "All agents",
            },
          ],
          hasMore: false,
        })}
        status="completed"
        attachments={[]}
        forceOpen
      />
    </AgentAvatarPalette>
  ))
  mounted.push(card)

  const stack = await waitFor(() =>
    card.host.querySelector('[data-slot="board-route-recipient-icon"] [data-component="board-participant-stack"]'),
  )
  expect(stack.querySelectorAll('[data-component="agent-avatar"]')).toHaveLength(2)
})

function BoardPostPreview() {
  const Renderer = ToolRegistry.render("board_post")
  if (!Renderer) throw new Error("No renderer registered for board_post")
  return (
    <Renderer
      input={{ to: "ses_root", type: "RESULT", body: "Timeout fixed." }}
      metadata={{}}
      tool="board_post"
      partID="board-post-live"
      sessionID="ses_helper12345678"
      output=""
      status="running"
      attachments={[]}
    />
  )
}
