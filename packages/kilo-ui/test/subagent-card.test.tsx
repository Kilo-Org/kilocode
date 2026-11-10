import { afterEach, beforeEach, expect, test } from "bun:test"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { mountTool, type Mounted } from "./harness"

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
