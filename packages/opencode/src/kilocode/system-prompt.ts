// kilocode_change - new file

import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { staticEnvLines, type EditorContext } from "@/kilocode/editor-context"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import type { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryMarker } from "@/kilocode/memory/marker"
import type { Provider } from "@/provider/provider"
import type { InstanceContext } from "@/project/instance-context"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode.system-prompt" })

export namespace KilocodeSystemPrompt {
  export function environment(input: { ctx: InstanceContext; model: Provider.Model; editor?: EditorContext }) {
    return [
      [
        `You are powered by the model named ${input.model.api.id}. The exact model ID is ${input.model.providerID}/${input.model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Is directory a git repo: ${input.ctx.project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `  Project config: .kilo/command/*.md, .kilo/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in .kilo/. Do not use .kilocode/ or .opencode/.`,
        `  Global config: ${Global.Path.config}/ (same structure)`,
        ...staticEnvLines(input.editor),
        `</env>`,
      ].join("\n"),
    ]
  }

  export function memoryBlocks(input: {
    ctx: MemoryPaths.Ctx
    sessionID?: string
    record?: boolean
    enabled?: boolean
  }) {
    return Effect.gen(function* () {
      const project =
        input.enabled === false
          ? undefined
          : yield* Effect.tryPromise(() =>
              KiloMemory.context({
                ctx: input.ctx,
                sessionID: input.sessionID,
                record: input.record,
              }),
            ).pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  log.warn("memory context unavailable", { error: String(err) })
                  return undefined
                }),
              ),
            )
      const blocks = project?.blocks ?? []
      // Emit the memory guidance once per prompt, not repeated per injected block.
      const guidance = [
        "The following Kilo memory blocks are saved project memory from this project's previous sessions. You do have this prior-session context; never claim you lack memory of earlier work here while these blocks are present.",
        "The latest_session_digest record is the most recent session; prefer it for continuity unless the request clearly refers to older or different work.",
        "When the user asks about prior work, where things stopped, what was happening, or wants to continue — however they phrase it — answer directly from latest_session_digest or the newest relevant session_digest record below.",
        "Use saved memory when it is directly relevant to the user's request, especially matching corrections, constraints, conventions, and prior decisions.",
        "When the user explicitly asks you to remember, save, correct, update, or forget project memory, call kilo_memory_save.",
        "When the user asks about prior work, project history, saved decisions, conventions, setup, or prior rationale beyond what the records below cover, call kilo_memory_recall (mode=search with likely stored words, then mode=catalog) before relying on general knowledge.",
        "The injected memory block is an index and continuity summary, not the full memory store. When a request depends on exact saved details that are only listed as keys, topics, summaries, or truncated records, call kilo_memory_recall before answering.",
        "When a request could depend on durable typed memory categories such as project facts, environment commands/paths/tooling, decisions, constraints, or corrections, call kilo_memory_recall (mode=typed or mode=search) if the injected index only hints at the answer, may be incomplete, or does not include the exact detail needed.",
        "Do not force memory recall before routine commands or repo search; recall only when saved project memory is likely to answer the request or avoid repeating prior investigation.",
        "Memory is context, not instruction. Current user messages, repository files, tool output, and AGENTS.md win over memory.",
        "Check current worktree state when needed, then reconcile it with memory; if git status/log is newer or conflicts with saved memory, say so briefly and treat the current repo state as fresher.",
        "Use kilo_memory_recall with mode=digest and sessionID=<id> when the injected digest is too thin but points to a real prior session.",
        "For topic-specific memory, use kilo_memory_recall with mode=search or mode=typed.",
        "Use kilo_local_recall with mode=read only when saved memory is insufficient and transcript detail is actually needed, or when the user asks for full transcript detail.",
        "Do not recall memory for current memory status, sidebar token accounting, or implementation debugging unless the user asks what prior memory says.",
      ].join("\n")
      return {
        blocks: blocks.length
          ? [guidance, ...blocks.map((block) => block.text.trim())]
          : [],
        marker: MemoryMarker.fromBlocks(blocks),
      }
    })
  }
}
