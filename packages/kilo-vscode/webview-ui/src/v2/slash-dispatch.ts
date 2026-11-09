// Runs one slash menu entry: a client action in the webview, a server command through `session.command`, or a skill
// as a prompt that attaches it. Kept free of JSX and webview contexts, so the extension tests can load it.
import type { ModelRef, SessionCommandInput } from "@opencode/client"
import type { SlashEntry } from "./slash"

// The server reports and accepts "no explicit variant" as "default" (core session/info.ts).
const DEFAULT = "default"

export type SlashInput = {
  entry: SlashEntry
  /** The text after the command word. */
  args: string
  files?: SessionCommandInput["files"]
  delivery?: "steer" | "queue"
}

export type SlashDeps = {
  /** The session to run in. Resolves when it exists on the server and every pending model switch has settled. */
  session: () => Promise<string>
  /** The model the server session runs on now. */
  current: (sessionID: string) => ModelRef | undefined
  /** The model and reasoning variant the composer shows. */
  selected: ModelRef | undefined
  switchModel: (input: { sessionID: string; model: ModelRef }) => Promise<unknown>
  command: (input: SessionCommandInput) => Promise<unknown>
  prompt: (input: {
    sessionID: string
    text: string
    files?: SessionCommandInput["files"]
    skills: NonNullable<SessionCommandInput["skills"]>
    delivery?: "steer" | "queue"
  }) => Promise<unknown>
}

export async function dispatchSlash(input: SlashInput, deps: SlashDeps) {
  const entry = input.entry
  if (entry.kind === "action") return entry.run()
  const sessionID = await deps.session()
  // A command with its own model switches the session to it on the server. Everything else runs on the session
  // model, so that must be the model the composer shows, reasoning variant included.
  if (entry.kind === "skill" || !entry.command.model) await applyModel(sessionID, deps)
  if (entry.kind === "command")
    return deps.command({
      sessionID,
      name: entry.command.name,
      text: [entry.args, input.args].filter(Boolean).join(" "),
      files: input.files,
      delivery: input.delivery,
    })
  const mention = `/${entry.name}`
  return deps.prompt({
    sessionID,
    text: input.args ? `${mention} ${input.args}` : mention,
    files: input.files,
    skills: [{ id: entry.skill.id, mention: { start: 0, end: mention.length, text: mention } }],
    delivery: input.delivery,
  })
}

async function applyModel(sessionID: string, deps: SlashDeps) {
  const selected = deps.selected
  if (!selected) return
  const current = deps.current(sessionID)
  if (current && same(current, selected)) return
  // Send the variant explicitly: a model without one means "default" to the server and would reset the effort.
  await deps.switchModel({ sessionID, model: { ...selected, variant: selected.variant ?? DEFAULT } })
}

function same(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? DEFAULT) === (b.variant ?? DEFAULT)
}
