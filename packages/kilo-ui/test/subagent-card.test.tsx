import { afterEach, beforeEach, expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode/client"
import { createSignal } from "solid-js"
import { ToolRegistry, type ToolProps } from "../src/components/message-part"
import { ToolChildSessionProvider, type ToolChildSession } from "../src/components/tool-child-session"
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

function actions() {
  const calls: string[] = []
  return {
    calls,
    value: {
      stopSession: (id: string) => calls.push(`stop:${id}`),
      backgroundSession: (id: string) => calls.push(`background:${id}`),
    },
  }
}

const action = (card: Mounted, name: string) =>
  card.host.querySelector<HTMLElement>(`[data-slot="task-tool-action"][data-action="${name}"]`)

test("a running foreground subagent offers stop and continue in background", () => {
  const spy = actions()
  const card = mountTool("subagent", {
    input: { agent: "explore", description: "Find usages", prompt: "go" },
    metadata: { sessionID: "ses_child", status: "running" },
    status: "running",
    partID: "subagent-foreground",
    actions: spy.value,
  })
  mounted.push(card)

  action(card, "background")?.click()
  action(card, "stop")?.click()

  expect(spy.calls).toEqual(["background:ses_child", "stop:ses_child"])
})

test("a background subagent never offers continue in background", () => {
  const spy = actions()
  const card = mountTool("subagent", {
    input: { agent: "explore", description: "Find usages", prompt: "go", background: true },
    metadata: { sessionID: "ses_child", status: "running" },
    status: "completed",
    partID: "subagent-background",
    actions: spy.value,
  })
  mounted.push(card)

  expect(action(card, "background")).toBeNull()
  expect(card.host.textContent).not.toContain("Background agent")
  // Stop follows the child session status, which this card has no source for, so the completed tool part hides it.
  expect(action(card, "stop")).toBeNull()
})

test("a card without the actions shows neither control", () => {
  const card = mountTool("subagent", {
    input: { agent: "explore", description: "Find usages", prompt: "go" },
    metadata: { sessionID: "ses_child", status: "running" },
    status: "running",
    partID: "subagent-readonly",
  })
  mounted.push(card)

  expect(action(card, "background")).toBeNull()
  expect(action(card, "stop")).toBeNull()
})

test("open prefers the client's subagent surface and passes the description", () => {
  const calls: string[] = []
  const card = mountTool("subagent", {
    input: { agent: "explore", description: "Find usages", prompt: "go" },
    metadata: { sessionID: "ses_child", status: "running" },
    status: "running",
    partID: "subagent-open",
    actions: {
      openSession: (id) => calls.push(`session:${id}`),
      openSubagent: (id, title) => calls.push(`subagent:${id}:${title}`),
    },
  })
  mounted.push(card)

  card.host.querySelector<HTMLElement>('[data-slot="task-tool-open"]')?.click()

  expect(calls).toEqual(["subagent:ses_child:Find usages"])
})

const childTool = {
  type: "tool",
  id: "child-tool-1",
  name: "read",
  state: { status: "completed", input: { path: "packages/child.ts" }, content: [] },
} as unknown as SessionMessageAssistantTool

function mountChildCard(child: ToolChildSession, props: Partial<ToolProps> = {}) {
  const Renderer = ToolRegistry.render("subagent")
  if (!Renderer) throw new Error("No renderer registered for subagent")
  const merged: ToolProps = {
    input: { agent: "explore", description: "Find usages", prompt: "go" },
    metadata: { sessionID: "ses_child", status: "running" },
    tool: "subagent",
    partID: "subagent-child",
    output: "",
    status: "running",
    attachments: [],
    ...props,
  }
  return mountRich(() => (
    <ToolChildSessionProvider value={child}>
      <Renderer {...merged} />
    </ToolChildSessionProvider>
  ))
}

test("a card asks for the child history again when its cached tools disappear", async () => {
  const [tools, setTools] = createSignal<SessionMessageAssistantTool[]>([])
  const loads: string[] = []
  const card = mountChildCard({
    tools: () => tools(),
    running: () => true,
    load: (id) => {
      loads.push(id)
      // The real loader fetches asynchronously.
      void Promise.resolve().then(() => setTools([childTool]))
    },
  })
  mounted.push(card)
  const starting = () => card.host.querySelector('[data-slot="task-tool-item"][data-state="starting"]')
  const tool = () => card.host.querySelector('[data-slot="task-tool-item"]:not([data-state="starting"])')

  await waitFor(tool)
  expect(loads).toEqual(["ses_child"])

  // The inspector releases a subagent when its tab closes, which empties the cached history under the open card.
  setTools([])
  await waitFor(starting)
  await waitFor(() => loads.length === 2)
  await waitFor(tool)
  expect(loads).toEqual(["ses_child", "ses_child"])
})
