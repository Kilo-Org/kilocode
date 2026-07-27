// kilocode_change - new file

import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
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
  export function chartInstructions(): string | undefined {
    if (Flag.KILO_CLIENT !== "vscode") return undefined
    return [
      "# Data Visualization",
      "",
      "The `chart` tool is ALWAYS available in this environment. When the user asks to visualize data (charts, graphs, plots), you MUST call the `chart` tool. Never output the config as text, never say the tool is unavailable, never suggest external renderers. Always use the tool call — it is the only correct response for data visualization requests. Do NOT repeat or echo the config JSON in your text response.",
      "",
      "Use the `chart` tool when:",
      "- The user asks for a chart, graph, or plot of data (bar, line, scatter, pie, time series, etc.)",
      "- Presenting numerical data that would be clearer visually than as a table or prose (trends, comparisons, distributions)",
      "",
      "Use mermaid fenced code blocks (` ```mermaid `) when:",
      "- The user asks for a diagram, flowchart, sequence diagram, ER diagram, or architecture diagram",
      "- Visualizing relationships, processes, or structure — not data values",
      "",
      "Mermaid is NOT a tool — just write the mermaid syntax directly in your text response inside a fenced code block. No tool call needed.",
      "",
      "Do not use either for: code, text, or data that is already clear in prose or table form.",
      "",
      "The `chart` tool input accepts:",
      "- `title` (string) — short label shown in the tool header",
      "- `description` (string, optional) — subtitle shown below the title",
      "- `spec` (string) — a Chart.js config object as a JSON string",
      "",
      "The `spec` field must be a Chart.js config JSON string with `type`, `data`, and optionally `options`. Examples:",
      "",
      "Bar chart:",
      "```json",
      '{',
      '  "type": "bar",',
      '  "data": {',
      '    "labels": ["A", "B", "C"],',
      '    "datasets": [{ "label": "Value", "data": [10, 20, 15] }]',
      '  }',
      '}',
      "```",
      "",
      "Line chart:",
      "```json",
      '{',
      '  "type": "line",',
      '  "data": {',
      '    "labels": ["Jan", "Feb", "Mar", "Apr"],',
      '    "datasets": [{ "label": "Value", "data": [10, 28, 19, 45], "fill": false }]',
      '  }',
      '}',
      "```",
      "",
      "Scatter plot:",
      "```json",
      '{',
      '  "type": "scatter",',
      '  "data": {',
      '    "datasets": [{',
      '      "label": "Points",',
      '      "data": [{ "x": 1, "y": 5 }, { "x": 2, "y": 8 }, { "x": 3, "y": 3 }]',
      '    }]',
      '  }',
      '}',
      "```",
      "",
      "Time series:",
      "```json",
      '{',
      '  "type": "line",',
      '  "data": {',
      '    "labels": ["2024-01", "2024-02", "2024-03", "2024-04"],',
      '    "datasets": [{ "label": "Value", "data": [120, 145, 132, 178], "fill": true }]',
      '  }',
      '}',
      "```",
      "",
      "Pie chart:",
      "```json",
      '{',
      '  "type": "pie",',
      '  "data": {',
      '    "labels": ["A", "B", "C"],',
      '    "datasets": [{ "data": [30, 50, 20] }]',
      '  }',
      '}',
      "```",
      "",
      "You may customize colors by setting `backgroundColor` and `borderColor` arrays on datasets. The renderer handles sizing — do not set width or height.",
    ].join("\n")
  }

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
      chartInstructions(),
    ].filter((x): x is string => x !== undefined)
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
