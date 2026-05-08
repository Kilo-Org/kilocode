import { ConfigModelID } from "@/config/model-id"
import { ModelID, ProviderID } from "@/provider/schema"
import { Schema } from "effect"
import type { MessageV2 } from "@/session/message-v2"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export namespace KiloCommandSubtasks {
  export const Entry = Schema.Struct({
    agent: Schema.String,
    model: Schema.optional(ConfigModelID),
    description: Schema.optional(Schema.String),
  }).pipe(withStatics((s) => ({ zod: zod(s) })))
  export type Entry = Schema.Schema.Type<typeof Entry>

  export type Batch = {
    command: string
    tasks: MessageV2.SubtaskPart[]
  }

  export const SYNTHESIS_PROMPT = "Synthesize the subtask tool outputs above and continue with your task."

  export function has(input?: { subtasks?: readonly Entry[] }) {
    return (input?.subtasks?.length ?? 0) > 0
  }

  function parse(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(rest.join("/")),
    }
  }

  export function description(input: { task: Entry; index: number }) {
    if (input.task.description) return input.task.description
    return ["command subtask", String(input.index + 1), input.task.agent, input.task.model].filter(Boolean).join(" ")
  }

  export function build(input: {
    subtasks?: readonly Entry[]
    prompt: string
    command: string
    model?: string
  }): MessageV2.SubtaskPartInput[] {
    return (input.subtasks ?? []).map((task, index) => {
      const model = task.model ?? input.model
      const parsed = model ? parse(model) : undefined
      return {
        type: "subtask",
        agent: task.agent,
        description: description({ task, index }),
        command: input.command,
        ...(parsed ? { model: parsed } : {}),
        prompt: input.prompt,
      }
    })
  }

  export function match(input: { task: MessageV2.SubtaskPart; part: MessageV2.ToolPart }) {
    if (input.part.tool !== "task") return false
    if (!["completed", "running", "error"].includes(input.part.state.status)) return false
    const args = input.part.state.input
    return (
      args.prompt === input.task.prompt &&
      args.description === input.task.description &&
      args.subagent_type === input.task.agent
    )
  }

  export function pending(input: { user?: MessageV2.User; messages: MessageV2.WithParts[] }): Batch | undefined {
    if (!input.user) return
    const msg = input.messages.find((item) => item.info.id === input.user?.id)
    const tasks = msg?.parts.filter((part): part is MessageV2.SubtaskPart => part.type === "subtask") ?? []
    if (tasks.length < 2) return
    const command = tasks[0]?.command
    if (!command || !tasks.every((task) => task.command === command)) return

    const tools = input.messages
      .filter((item) => item.info.role === "assistant" && item.info.parentID === input.user?.id)
      .flatMap((item) => item.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool"))
    const pending = tasks.filter((task) => !tools.some((part) => match({ task, part })))
    if (!pending.length) return
    return { command, tasks: pending }
  }

  export function synthesis() {
    return SYNTHESIS_PROMPT
  }
}
