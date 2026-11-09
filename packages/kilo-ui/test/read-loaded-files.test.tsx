import { afterEach, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { ContentPart, type ToolActions } from "../src/components/message-part"
import { mountRich, waitFor, type Mounted } from "./harness"

const mounted: Mounted[] = []

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted.length = 0
})

function mountRead(loadedFiles?: readonly string[], actions?: ToolActions) {
  const item: SessionMessageAssistantTool = {
    type: "tool",
    id: "read",
    name: "read",
    time: { created: 1 },
    state: {
      status: "completed",
      input: { path: "src/math.ts" },
      content: [{ type: "text", text: "1: const VALUE = 1" }],
      metadata: { truncated: false },
    },
  }
  const message: SessionMessageAssistant = {
    id: "message",
    type: "assistant",
    agent: "default",
    model: { id: "test", providerID: "test" },
    content: [item],
    time: { created: 1 },
  }
  const card = mountRich(() => (
    <ContentPart item={item} message={message} index={0} directory="/repo" loadedFiles={loadedFiles} actions={actions} />
  ))
  mounted.push(card)
  return card
}

test("read card lists the instruction files it loaded", async () => {
  const opened: string[] = []
  const card = mountRead(["/repo/AGENTS.md", "/repo/src/AGENTS.md"], { openFile: (path) => opened.push(path) })
  await waitFor(() => card.host.querySelector('[data-slot="basic-tool-tool-title"]'))

  const files = [...card.host.querySelectorAll<HTMLElement>('[data-component="tool-loaded-file"]')]
  expect(files.map((file) => file.textContent)).toEqual(["Loaded AGENTS.md", "Loaded src/AGENTS.md"])

  files[1]?.click()
  expect(opened).toEqual(["/repo/src/AGENTS.md"])
})

test("read card shows no list when no instruction file was loaded", async () => {
  const card = mountRead()
  await waitFor(() => card.host.querySelector('[data-slot="basic-tool-tool-title"]'))

  expect(card.host.querySelector('[data-component="tool-loaded-file"]')).toBeNull()
})
