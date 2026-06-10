import { useEvent } from "@tui/context/event"
import type {
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@kilocode/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

function activeAssistant(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function activeCompaction(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "compaction")
  if (index < 0) return
  const compaction = messages[index]
  return compaction?.type === "compaction" ? compaction : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined) {
  return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
}

export const { use: useSyncV2, provider: SyncProviderV2 } = createSimpleContext({
  name: "SyncV2",
  init: () => {
    const [store, setStore] = createStore<{
      messages: {
        [sessionID: string]: SessionMessage[]
      }
    }>({
      messages: {},
    })

    const event = useEvent()
    const sdk = useSDK()

    function update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
      setStore(
        "messages",
        produce((draft) => {
          fn((draft[sessionID] ??= []))
        }),
      )
    }

    event.sync((event) => {
      switch (event.name) {
        case "session.next.prompted.1": {
          update(event.data.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "user",
              text: event.data.prompt.text,
              files: event.data.prompt.files,
              agents: event.data.prompt.agents,
              time: { created: event.data.timestamp },
            })
          })
          break
        }
        case "session.next.synthetic.1":
          update(event.data.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "synthetic",
              sessionID: event.data.sessionID,
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.started.1":
          update(event.data.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "shell",
              callID: event.data.callID,
              command: event.data.command,
              output: "",
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.ended.1":
          update(event.data.sessionID, (draft) => {
            const match = activeShell(draft, event.data.callID)
            if (!match) return
            match.output = event.data.output
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.step.started.1":
          update(event.data.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.data.timestamp
            draft.unshift({
              id: event.id,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.step.ended.1":
          update(event.data.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = event.data.finish
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
            if (event.data.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
          })
          break
        case "session.next.step.failed.1":
          update(event.data.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.data.error
          })
          break
        case "session.next.text.started.1":
          update(event.data.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({ type: "text", text: "" })
          })
          break
        case "session.next.text.delta.1":
          update(event.data.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.text.ended.1":
          update(event.data.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text = event.data.text
          })
          break
        case "session.next.tool.input.started.1":
          update(event.data.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "tool",
              id: event.data.callID,
              name: event.data.name,
              time: { created: event.data.timestamp },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta.1":
          update(event.data.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.data.callID)
            if (match?.state.status === "pending") match.state.input += event.data.delta
          })
          break
        case "session.next.tool.input.ended.1":
          break
        case "session.next.tool.called.1":
          update(event.data.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.data.callID)
            if (!match) return
            match.time.ran = event.data.timestamp
            match.provider = event.data.provider
            match.state = { status: "running", input: event.data.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress.1":
          update(event.data.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.data.callID)
            if (match?.state.status !== "running") return
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          })
          break
        case "session.next.tool.success.1":
          update(event.data.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.data.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.data.structured,
              content: [...event.data.content],
            }
            match.provider = event.data.provider
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.tool.failed.1":
          update(event.data.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.data.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "error",
              error: event.data.error,
              input: match.state.input,
              structured: match.state.structured,
              content: match.state.content,
            }
            match.provider = event.data.provider
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.reasoning.started.1":
          update(event.data.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "reasoning",
              id: event.data.reasoningID,
              text: "",
            })
          })
          break
        case "session.next.reasoning.delta.1":
          update(event.data.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.data.reasoningID)
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.reasoning.ended.1":
          update(event.data.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.data.reasoningID)
            if (match) match.text = event.data.text
          })
          break
        case "session.next.retried.1":
          break
        case "session.next.compaction.started.1":
          update(event.data.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "compaction",
              reason: event.data.reason,
              summary: "",
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.compaction.delta.1":
          update(event.data.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (match) match.summary += event.data.text
          })
          break
        case "session.next.compaction.ended.1":
          update(event.data.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (!match) return
            match.summary = event.data.text
            match.include = event.data.include
          })
          break
      }
    })

    const result = {
      data: store,
      session: {
        message: {
          async sync(sessionID: string) {
            const response = await sdk.client.v2.session.messages({ sessionID })
            setStore("messages", sessionID, reconcile(response.data?.items ?? []))
          },
          fromSession(sessionID: string) {
            const messages = store.messages[sessionID]
            if (!messages) return []
            return messages
          },
        },
      },
    }

    return result
  },
})
