export * as KiloReview from "./index"

import { Config } from "@opencode/core/config"
import { ConfigEntryObserver } from "@opencode/core/config/plugin/entry-observer"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { KiloPromptInjected } from "@opencode/core/kilocode/session/injected"
import { define } from "@opencode/plugin/effect/plugin"
import type { ConfigModel } from "@opencode/schema/config/model"
import { Effect, Option, Predicate } from "effect"
import PROMPT from "./review.txt"

export const name = "review"
export const description = "review changes [uncommitted|staged|unpushed|branch|commit|pr]"

/**
 * The prompt of one `/review` invocation: the text typed after the command replaces `$ARGUMENTS`. A configured review
 * model goes to the sub-agents, so the invoking session keeps its own model and prompt cache.
 */
export function template(input: string, model?: ConfigModel.Selection) {
  const text = PROMPT.replaceAll("$ARGUMENTS", () => input.trim())
  if (!model) return text
  const ref = reference(model)
  const section = [
    "## Review Model",
    "",
    `The user configured \`${ref}\` as the review model for \`/review\` to keep reviews cheap. The review work runs in sub-agents on that model, and this session only coordinates, so keep your own token use to a minimum. These rules override the Required Workflow and How to Review where they differ:`,
    "",
    "- Determine and validate the scope as usual, but do not read the full diff, changed files or untracked file contents yourself. Size the change only from counts: `git diff --numstat` with the refs of the selected scope, `git show --numstat --format= <commit>` for a commit, or `gh pr view <pr> --json additions,deletions,changedFiles` for a pull request, plus `git ls-files --others --exclude-standard` for local scopes.",
    `- Every \`subagent\` call you make for this review runs on \`${ref}\` and waits for its result; pass \`model: "${ref}"\`. Start all review sub-agents in one message so they run in parallel.`,
    "- Give each sub-agent the commands that produce the selected diff, so it reads the diff and files itself.",
    "- In quick mode and for small diffs, spawn exactly one sub-agent that covers every relevant track instead of reviewing in this session.",
    "- Once the sub-agents have returned, continue from step 8: filter and deduplicate the findings, re-check only the reported lines with a targeted `git diff -- <file>`, then write the final review yourself.",
    "",
    "---",
    "",
  ].join("\n")
  return text.replace("## Required Workflow", () => `${section}## Required Workflow`)
}

// The command registry keeps the last definition of a name. This plugin runs after the built-in plugins and before the
// config plugins, so it replaces the built-in `review`, and a config-defined `review` still replaces it. A model-only
// `commands.review` entry selects the review model.
export const Plugin = define({
  id: "kilocode.review",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    const loaded = Option.isSome(config)
      ? yield* ConfigEntryObserver.observe(config.value, ctx.event, ctx.command.reload())
      : { entries: [] }
    // Sessions running a review with a review model. Every new subagent they spawn runs on it, whatever model the
    // reviewing agent passed, until the session goes idle with no subagent left running. Review subagents run in the
    // foreground: parallel calls in one step still run concurrently, and the session's model then continues once
    // with every result instead of waking for each finished subagent.
    const reviews = new Map<string, string>()
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        const ref = reviews.get(event.sessionID)
        if (ref === undefined || event.tool !== "subagent" || !Predicate.isObject(event.input)) return
        if (typeof event.input.sessionID === "string" && event.input.sessionID !== "") return
        event.input = { ...event.input, model: ref, background: false }
      }),
    )
    yield* ctx.session.hook("experimental.idle", (event) =>
      Effect.sync(() => {
        if (event.background.some((work) => work.kind === "subagent" && work.sessionID === event.sessionID)) return
        reviews.delete(event.sessionID)
      }),
    )
    yield* ctx.command.transform((editor) => {
      const model = KiloConfigPolicy.workflowModel(loaded.entries, name)
      editor.add({
        name,
        description,
        template: PROMPT,
        ...(model ? { model } : {}),
        execute: (input) =>
          Effect.sync(() => {
            if (model) reviews.set(input.sessionID, reference(model))
          }).pipe(
            Effect.andThen(
              ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: template(input.prompt.text, model),
                metadata: KiloPromptInjected.command(name, input.prompt.text),
                delivery: input.delivery,
              }),
            ),
            Effect.asVoid,
          ),
      })
    })
  }),
})

function reference(model: ConfigModel.Selection) {
  return `${model.providerID}/${model.model}${model.variant ? `#${model.variant}` : ""}`
}
