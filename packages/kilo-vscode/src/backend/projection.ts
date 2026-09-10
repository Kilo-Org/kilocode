import type { SessionInfo, SessionMessageInfo, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import type { Session, Message, Part, ToolPart } from "./view-types"

/** Existing extension view shapes; all runtime data comes from the native v2 client. */
export function sessionView(session: SessionInfo): Session {
  return {
    id: session.id,
    slug: session.id,
    version: "v2",
    projectID: session.projectID,
    directory: session.location.directory,
    workspaceID: session.location.workspaceID,
    parentID: session.parentID,
    title: session.title ?? "",
    agent: session.agent,
    model: session.model,
    time: session.time,
    cost: session.cost,
    tokens: session.tokens,
    metadata: session.metadata,
    revert: session.revert,
  }
}

export function messageViews(session: SessionInfo, messages: readonly SessionMessageInfo[]) {
  let agent = messages.find((message) => message.type === "agent-switched")?.previous ?? session.agent ?? ""
  let model = messages.find((message) => message.type === "model-switched")?.previous ?? session.model
  let parentID = session.id
  return messages.flatMap((message): Array<{ info: Message; parts: Part[] }> => {
    if (message.type === "agent-switched") {
      agent = message.agent
      return []
    }
    if (message.type === "model-switched") {
      model = message.model
      return []
    }
    const identity = { sessionID: session.id, messageID: message.id }
    if (message.type === "user") {
      parentID = message.id
      return [
        {
          info: {
            id: message.id,
            sessionID: session.id,
            role: "user",
            time: message.time,
            agent,
            model: { providerID: model?.providerID ?? "", modelID: model?.id ?? "", variant: model?.variant },
          },
          parts: [
            { ...identity, id: `${message.id}:text`, type: "text", text: message.text },
            ...(message.agents ?? []).map((agent, index): Part => ({
              ...identity,
              id: `${message.id}:agent:${index}`,
              type: "agent",
              name: agent.name,
              source: agent.mention
                ? { value: agent.mention.text, start: agent.mention.start, end: agent.mention.end }
                : undefined,
            })),
            ...(message.files ?? []).map(
              (file, index): Part => ({
                ...identity,
                id: `${message.id}:file:${index}`,
                type: "file",
                mime: file.mime,
                filename: file.name,
                url: `data:${file.mime};base64,${file.data}`,
              }),
            ),
          ],
        },
      ]
    }
    if (message.type !== "assistant") return []
    return [
      {
        info: {
          id: message.id,
          sessionID: session.id,
          role: "assistant",
          time: message.time,
          parentID,
          modelID: message.model.id,
          providerID: message.model.providerID,
          variant: message.model.variant,
          agent: message.agent,
          mode: message.agent,
          path: { cwd: session.location.directory, root: session.location.directory },
          cost: message.cost ?? 0,
          tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: message.finish,
          error: message.error ? { name: "UnknownError", data: { message: message.error.message } } : undefined,
        },
        parts: message.content.map((part, index): Part => {
          const id = `${message.id}:${index}`
          if (part.type === "text") return { ...identity, id, type: "text", text: part.text }
          if (part.type === "reasoning")
            return {
              ...identity,
              id,
              type: "reasoning",
              text: part.text,
              time: { start: part.time?.created ?? message.time.created, end: part.time?.completed },
            }
          return {
            ...identity,
            id: part.id,
            type: "tool",
            callID: part.id,
            tool: part.name,
            state: toolState(part, identity),
          }
        }),
      },
    ]
  })
}

function toolState(
  tool: SessionMessageAssistantTool,
  identity: { sessionID: string; messageID: string },
): ToolPart["state"] {
  const state = tool.state
  const start = tool.time.ran ?? tool.time.created
  if (state.status === "streaming") return { status: "pending", input: {}, raw: state.input }
  if (state.status === "running")
    return { status: "running", input: state.input, metadata: state.metadata, time: { start } }
  if (state.status === "error")
    return {
      status: "error",
      input: state.input,
      error: state.error.message,
      metadata: state.metadata,
      time: { start, end: tool.time.completed ?? start },
    }
  return {
    status: "completed",
    input: state.input,
    output: state.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    title: tool.name,
    metadata: state.metadata ?? {},
    attachments: state.content.flatMap((part, index) =>
      part.type === "file"
        ? [
            {
              ...identity,
              id: `${tool.id}:attachment:${index}`,
              type: "file" as const,
              mime: part.mime,
              filename: part.name ?? undefined,
              url: part.uri,
            },
          ]
        : [],
    ),
    time: { start, end: tool.time.completed ?? start },
  }
}
