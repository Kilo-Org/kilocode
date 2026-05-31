import { Command } from "../../command"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./tool.txt"
import { Tool } from "../../tool/tool"
import { Suggestion } from "./index"
import { SessionStatus } from "../../session/status"
import { SessionID } from "../../session/schema"

const log = Log.create({ service: "tool.suggest" })

const Params = Schema.Struct({
  suggest: Schema.String.annotate({ description: "Short suggestion text shown to the user" }),
  actions: Schema.Array(Suggestion.ActionSchema)
    .check(Schema.isMinLength(1), Schema.isMaxLength(2))
    .annotate({ description: "Available actions the user can take" }),
})

type Meta = {
  accepted?: Suggestion.Action
  dismissed: boolean
  truncated: boolean
}

function fill(template: string, args: string) {
  if (template.includes("$ARGUMENTS")) return template.replaceAll("$ARGUMENTS", args)
  return args ? `${template}\n\n${args}` : template
}

/**
 * If prompt starts with `/`, treat it as a slash-command reference.
 * Resolve the command template and return its content so the LLM can
 * act on it in the current turn — without injecting a synthetic user
 * message or trying to dispatch a command on the same session (which
 * would deadlock).
 */
export function resolvePrompt(prompt: string, commands: Command.Interface) {
  return Effect.gen(function* () {
    if (!prompt.startsWith("/")) return prompt

    const name = prompt.slice(1).split(/\s/, 1)[0]
    if (!name) return prompt

    const args = prompt.slice(1 + name.length).trim()
    const cmd = yield* commands.get(name)
    if (!cmd) {
      log.warn("unknown command in suggestion action", { name })
      return prompt
    }

    return yield* Effect.tryPromise(() => Promise.resolve(cmd.template)).pipe(
      Effect.map((template) => {
        log.info("resolved command template", { name, length: template.length })
        return fill(template, args)
      }),
      Effect.catch((err) => {
        log.warn("failed to resolve command template", { name, err })
        return Effect.succeed(prompt)
      }),
    )
  })
}

export const SuggestTool = Tool.define<typeof Params, Meta, Command.Service | SessionStatus.Service, "suggest">(
  "suggest",
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const status = yield* SessionStatus.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const promise = Suggestion.show({
            sessionID: ctx.sessionID,
            text: params.suggest,
            actions: params.actions.map((a) => ({ ...a })),
            blocking: false, // render above an active input; VS Code does the same
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const listener = () =>
            Suggestion.list().then((items: Suggestion.Request[]) => {
              const match = items.find((item: Suggestion.Request) => item.tool?.callID === ctx.callID)
              if (match) return Suggestion.dismiss(match.id)
            })
          ctx.abort.addEventListener("abort", listener, { once: true })

          // Mark the session as idle while waiting for user interaction so the
          // session doesn't appear stuck/busy. The loop will set it back to busy
          // when the suggestion resolves and processing continues.
          yield* status
            .set(SessionID.make(ctx.sessionID), { type: "idle" })
            .pipe(Effect.catchCause((cause) => Effect.sync(() => log.warn("failed to set idle status", { cause }))))

          const action = yield* Effect.promise(() =>
            promise
              .catch((error) => {
                if (error instanceof Suggestion.DismissedError) return undefined
                throw error
              })
              .finally(() => {
                ctx.abort.removeEventListener("abort", listener)
              }),
          )

          // Restore busy immediately on accept so the session doesn't flash idle
          // while the follow-up response is being generated. The next runLoop
          // iteration sets busy too, but not until after the stream finalizes.
          if (action) {
            yield* status
              .set(SessionID.make(ctx.sessionID), { type: "busy" })
              .pipe(
                Effect.catchCause((cause) => Effect.sync(() => log.warn("failed to restore busy status", { cause }))),
              )
          }

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

          const resolved = yield* resolvePrompt(action.prompt, commands)
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
    }
  }),
)
