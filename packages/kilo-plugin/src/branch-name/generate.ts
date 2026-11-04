export * as BranchNameGenerate from "./generate.js"

import type { Model } from "@opencode/schema/model"
import { Effect, Option } from "effect"

const LIMIT = 4
const CHARS = 1_000
const BRANCH_CHARS = 50
const TIMEOUT_SECONDS = 10
const TEMPERATURE = 0.1

const PROMPT = `Generate a Git branch name for the coherent engineering workstream described by the user's messages.

Return exactly one line:
- a lowercase kebab-case branch slug, or
- null when there is not yet a clear, stable workstream

Return null for greetings, acknowledgements, capability questions, casual conversation, vague requests, unresolved brainstorming, or messages that only select an option without enough preceding context.
Return null when the messages only ask a question or check a status and do not describe work to perform (for example "is X fixed?", "check whether ...").
A concrete implementation, investigation, planning, documentation, or research task is a valid workstream.
Name the durable goal or outcome, not a tentative implementation detail. Prefer an action and object, such as fix-token-refresh-race or research-branch-naming.
If the user asks for a specific branch name, prefer that name.
Do not include a prefix, ticket number, explanation, quotes, markdown, or punctuation other than hyphens.`

/** The model request, so tests can run generation without a provider. */
export interface Runtime {
  readonly model: (input: { providerID?: string; modelID?: string }) => Effect.Effect<Model.Ref | undefined>
  readonly text: (input: {
    prompt: string
    system: string
    temperature: number
    model?: Model.Ref
  }) => Effect.Effect<string, unknown>
}

export interface Request {
  readonly messages: ReadonlyArray<string>
  readonly providerID?: string
  readonly modelID?: string
}

export const generate = Effect.fn("BranchName.generate")(function* (request: Request, runtime: Runtime) {
  if (request.messages.length === 0) return null
  const model = yield* runtime.model({ providerID: request.providerID, modelID: request.modelID })
  const body = request.messages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
  const result = yield* runtime
    .text({
      prompt: `User messages, oldest to newest:\n\n${body}`,
      system: PROMPT,
      temperature: TEMPERATURE,
      ...(model ? { model } : {}),
    })
    .pipe(
      Effect.timeoutOption(`${TIMEOUT_SECONDS} seconds`),
      Effect.map(Option.getOrUndefined),
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
  if (result === undefined) return null
  return parse(result)
})

/** Uses the recent real user messages, then the pending prompt unless it is already the latest message. */
export function messages(history: ReadonlyArray<string>, latest: string) {
  const prior = history.map((message) => message.trim()).filter(Boolean)
  const prompt = latest.trim()
  const all = normalize(prior.at(-1) ?? "") === normalize(prompt) || !prompt ? prior : [...prior, prompt]
  return all.slice(-LIMIT).map((message) => message.slice(0, CHARS))
}

/** The user-visible text of a stored user message, in order. */
export function userMessages(history: ReadonlyArray<{ readonly type: string; readonly text?: string }>) {
  return history.flatMap((message) =>
    message.type === "user" && message.text !== undefined ? [message.text] : [],
  )
}

export function parse(value: string) {
  const line = value
    .replace(/\u003cthink\u003e[\s\S]*?\u003c\/think\u003e\s*/gi, "")
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

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ")
}
