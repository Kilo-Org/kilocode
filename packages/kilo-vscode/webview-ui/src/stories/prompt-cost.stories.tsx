import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For } from "solid-js"
import { TranscriptRowView } from "../components/chat/TranscriptRow"
import { messageTurns } from "../context/session-queue"
import { transcriptRows } from "../context/transcript-rows"
import type { Message, Part } from "../types/messages"
import { StoryProviders, defaultMockData } from "./StoryProviders"

export default { title: "Chat", parameters: { layout: "fullscreen" } } satisfies Meta

export const PromptCost: StoryObj = {
  name: "Prompt cost and duration",
  render: () => {
    const sid = "prompt-cost"
    const stamp = Date.UTC(2026, 9, 15, 13)
    const samples = [
      { prompt: "Summarize the changes.", response: "Updated the login form and added tests.", cost: 0.0801 },
      { prompt: "Check the spelling.", response: "The spelling is correct.", cost: 0 },
      { prompt: "Explain the result.", response: "All checks pass. This provider did not report a cost." },
    ]
    const messages: Message[] = samples.flatMap((sample, index) => {
      const base = { sessionID: sid, createdAt: new Date(stamp).toISOString() }
      const start = stamp + index * 60_000
      return [
        { ...base, id: `u${index}`, role: "user", time: { created: start } },
        {
          ...base,
          id: `a${index}`,
          parentID: `u${index}`,
          role: "assistant",
          time: { created: start + 100, completed: start + 18_000 },
          finish: "stop",
          cost: sample.cost,
        },
      ]
    })
    const parts: Record<string, Part[]> = Object.fromEntries(
      samples.flatMap((sample, index) =>
        [sample.prompt, sample.response].map((text, role) => {
          const id = `${role === 0 ? "u" : "a"}${index}`
          return [id, [{ id: `p-${id}`, messageID: id, sessionID: sid, type: "text", text }]]
        }),
      ),
    )
    const rows = transcriptRows(messageTurns(messages), (id) => parts[id] ?? [])
    return (
      <StoryProviders data={{ ...defaultMockData, message: { [sid]: messages }, part: parts }} sessionID={sid}>
        <For each={rows}>{(row) => <TranscriptRowView row={row} />}</For>
      </StoryProviders>
    )
  },
}
