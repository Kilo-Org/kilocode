import { Command } from "../../command"
import { Log } from "../../util/log"
import z from "zod"
import { Effect } from "effect"
import DESCRIPTION from "./tool.txt"
import { Tool } from "../../tool/tool"
import { Suggestion } from "./index"

const log = Log.create({ service: "tool.suggest" })

const Params = z.object({
  suggest: z.string().describe("Short suggestion text shown to the user"),
  actions: z.array(Suggestion.Action).min(1).max(2).describe("Available actions the user can take"),
})

type Meta = {
  accepted?: Suggestion.Action
  dismissed: boolean
  truncated: boolean
}

/**
 * If prompt starts with `/`, treat it as a slash-command reference.
 * Resolve the command template and return its content so the LLM can
 * act on it in the current turn — without injecting a synthetic user
 * message or trying to dispatch a command on the same session (which
 * would deadlock).
 */
async function resolve(prompt: string): Promise<string> {
  if (!prompt.startsWith("/")) return prompt

  const name = prompt.slice(1).split(/\s/, 1)[0]
  if (!name) return prompt

  const args = prompt.slice(1 + name.length).trim()

  const cmd = await Command.get(name)
  if (!cmd) {
    log.warn("unknown command in suggestion action", { name })
    return prompt
  }

  try {
    const template = await cmd.template
    log.info("resolved command template", { name, length: template.length })
    return args ? `${template}\n\n${args}` : template
  } catch (err) {
    log.warn("failed to resolve command template", { name, err })
    return prompt
  }
}

export const SuggestTool = Tool.define<typeof Params, Meta, never, "suggest">(
  "suggest",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Params,
    execute: (params, ctx) =>
      Effect.promise(async () => {
        const promise = Suggestion.show({
          sessionID: ctx.sessionID,
          text: params.suggest,
          actions: params.actions,
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })

        const listener = () =>
          Suggestion.list().then((items: Suggestion.Request[]) => {
            const match = items.find((item: Suggestion.Request) => item.tool?.callID === ctx.callID)
            if (match) return Suggestion.dismiss(match.id)
          })
        ctx.abort.addEventListener("abort", listener, { once: true })

        const action = await promise
          .catch((error) => {
            if (error instanceof Suggestion.DismissedError) return undefined
            throw error
          })
          .finally(() => {
            ctx.abort.removeEventListener("abort", listener)
          })

        if (!action) {
          const metadata: Meta = {
            accepted: undefined,
            dismissed: true,
            truncated: false,
          }
          return {
            title: "Suggestion dismissed",
            output: "User dismissed the suggestion.",
            metadata,
          }
        }

        const resolved = await resolve(action.prompt)

        const metadata: Meta = {
          accepted: action,
          dismissed: false,
          truncated: false,
        }

        return {
          title: `User accepted: ${action.label}`,
          output: `User accepted the suggestion "${action.label}". Carry out the following request now:\n\n${resolved}`,
          metadata,
        }
      }),
  }),
)
