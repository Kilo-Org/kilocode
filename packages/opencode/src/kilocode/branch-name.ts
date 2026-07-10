import { Agent } from "@/agent/agent"
import { KiloLLM } from "@/kilocode/session/llm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Effect } from "effect"

const LIMIT = 4
const CHARS = 1_000
const BRANCH_CHARS = 50

const PROMPT = `Generate a Git branch name for the coherent engineering workstream described by the user's messages.

Return exactly one line:
- a lowercase kebab-case branch slug, or
- null when there is not yet a clear, stable workstream

Return null for greetings, acknowledgements, capability questions, casual conversation, vague requests, unresolved brainstorming, or messages that only select an option without enough preceding context.
A concrete implementation, investigation, planning, documentation, or research task is a valid workstream.
Name the durable goal or outcome, not a tentative implementation detail. Prefer an action and object, such as fix-token-refresh-race or research-branch-naming.
If the user asks for a specific branch name, prefer that name.
Do not include a prefix, ticket number, explanation, quotes, markdown, or punctuation other than hyphens.`

function text(message: MessageV2.WithParts) {
  return message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function messages(history: MessageV2.WithParts[], latest: string) {
  const prior = history
    .filter((message) => message.info.role === "user")
    .map(text)
    .filter(Boolean)
  const prompt = latest.trim()
  const all = normalize(prior.at(-1) ?? "") === normalize(prompt) || !prompt ? prior : [...prior, prompt]
  return all.slice(-LIMIT).map((message) => message.slice(0, CHARS))
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

export function parse(value: string) {
  const line = value
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
    .split("\n")[0]
    ?.trim()
    .replace(/^['"`]|['"`]$/g, "")
    .toLowerCase()
  if (!line || line === "null") return null
  return (
    line
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-")
      .slice(0, BRANCH_CHARS)
      .replace(/-+$/g, "") || null
  )
}

export const generate = Effect.fn("BranchName.generate")(function* (input: {
  sessionID: SessionID
  messages: string[]
  providerID?: ProviderV2.ID
  modelID?: ModelV2.ID
}) {
  if (input.messages.length === 0) return null

  const provider = yield* Provider.Service
  const llm = yield* LLM.Service
  const ref =
    input.providerID && input.modelID
      ? { providerID: input.providerID, modelID: input.modelID }
      : yield* provider.defaultModel()
  const model =
    (yield* provider.getSmallModel(ref.providerID)) ?? (yield* provider.getModel(ref.providerID, ref.modelID))
  const agent: Agent.Info = {
    name: "branch-name",
    mode: "primary",
    hidden: true,
    options: {},
    permission: [],
    prompt: PROMPT,
    temperature: 0.1,
  }
  const user: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: agent.name,
    model: { providerID: model.providerID, modelID: model.id },
  }
  const body = input.messages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
  const result = yield* KiloLLM.text(
    llm.stream({
      agent,
      user,
      tools: {},
      model,
      small: true,
      messages: [{ role: "user", content: `User messages, oldest to newest:\n\n${body}` }],
      sessionID: `branch-name:${input.sessionID}`,
      system: [],
      retries: 1,
    }),
  )
  return parse(result)
})
