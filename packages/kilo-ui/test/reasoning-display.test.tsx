import { expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { ContentPart } from "../src/components/message-part"
import { mountRich, waitFor } from "./harness"

const reasoning = "Check the greeting.\n\nThe trim happens before the name is inserted.\n\nRun both tests."
const message: SessionMessageAssistant = {
  id: "message",
  time: { created: 1000, completed: 2000 },
  type: "assistant",
  agent: "default",
  model: { id: "preview", providerID: "preview" },
  content: [{ type: "reasoning", id: "thought", text: reasoning, time: { created: 1000, completed: 1500 } }],
}

async function mountReasoning(mode: "expanded" | "preview" | "headline") {
  const view = mountRich(() => (
    <ContentPart item={message.content[0]!} message={message} index={0} reasoningDisplay={mode} />
  ))
  const root = await waitFor(() => view.host.querySelector<HTMLElement>('[data-component="reasoning-part"]'))
  return { view, root }
}

test("headline mode marks the reasoning block with data-headline", async () => {
  const { view, root } = await mountReasoning("headline")
  expect(root.hasAttribute("data-headline")).toBe(true)
  expect(root.hasAttribute("data-auto-collapse")).toBe(false)
  view.dispose()
})

test("preview mode caps the block with data-auto-collapse", async () => {
  const { view, root } = await mountReasoning("preview")
  expect(root.hasAttribute("data-auto-collapse")).toBe(true)
  expect(root.hasAttribute("data-headline")).toBe(false)
  view.dispose()
})

test("expanded mode carries neither marker", async () => {
  const { view, root } = await mountReasoning("expanded")
  expect(root.hasAttribute("data-auto-collapse")).toBe(false)
  expect(root.hasAttribute("data-headline")).toBe(false)
  view.dispose()
})
