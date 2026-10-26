export * as GatewayPrompt from "./prompt.js"

import type { KiloModels } from "@kilocode/gateway-core"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"
import GPT from "../../../core/src/plugin/system-prompt/gpt.txt"
import ASTRA from "../../../core/src/plugin/system-prompt/gpt-astra.txt"
import ANTHROPIC from "../../../core/src/plugin/system-prompt/anthropic.txt"
import TRINITY from "../../../core/src/plugin/system-prompt/trinity.txt"
import KIMI from "../../../core/src/plugin/system-prompt/kimi.txt"
import DEFAULT from "../../../core/src/session/runner/prompt/system.txt"

// Keep the current harness templates and adapt only main's missing model-specific instructions.
const EDITING = `# Editing and verification
- Prefer the smallest correct change. Default to ASCII unless the file already needs other characters.
- Do not amend commits or discard changes you did not make unless explicitly requested.
- Run the smallest relevant checks before completion. Report actual results and never claim an unrun check passed.`

const GEMINI = `# Gemini workflow
- Inspect the code, tests, and configuration before planning or editing. Verify that a library or framework is already used before relying on it.
- Understand the request, plan the work, implement it, then verify behavior and project standards with the project's checks.
- If asked how to do something, explain first. Confirm significant actions beyond the request's scope.
- For a new application, share the design and implementation plan and get approval before implementation.
- Use absolute paths for filesystem tool calls. Add comments sparingly to explain why, not what.
- Do not add a change summary unless asked.`

const LING = `# Ling workflow
- Before writing code, list a short sequence of implementation steps and follow it.
- For a bug fix, trace the execution path and state the root cause before editing. Then check for the same bug elsewhere in the file.
- Do not add code comments unless asked.
- After all requested edits are complete, use at most two final verification checks when needed: execute the code or read a specific uncertain section. Counting matching text is not verification.
- Once edits and checks are complete, report the conclusion in text and stop calling tools. Do not add a change summary unless asked.`

export function render(model: Pick<KiloModels.Model, "id" | "family" | "prompt">, tools: string[]) {
  const family = [model.id, model.family].join(" ").toLowerCase()
  const prompt =
    model.prompt ??
    (family.includes("claude")
      ? "anthropic"
      : family.includes("gpt")
        ? family.includes("astra") || family.includes("codex")
          ? "codex"
          : "beast"
        : family.includes("trinity")
          ? "trinity"
          : family.includes("gemini")
            ? "gemini"
            : family.includes("ling") &&
                !["kling", "bling", "spelling", "multilingual"].some((name) => family.includes(name))
              ? "ling"
              : undefined)
  const templates: Record<KiloModels.Prompt, string> = {
    codex: `${ASTRA}\n\n${EDITING}`,
    gpt55: `${tools.includes("subagent") ? ASTRA.replace("Do not spawn subagents unless the user or applicable AGENTS.md/skill instructions explicitly ask for subagents, delegation, or parallel agent work.", "Use the subagent tool proactively for focused independent subtasks. Run independent subtasks in parallel.") : ASTRA}\n\n${EDITING}`,
    beast: `${GPT}\n\n# Persistence and research
- Continue until the request is complete. Verify the result and fix failures you introduced before stopping.
- When the task depends on current third-party APIs or packages, check their documentation with available web tools.`,
    anthropic: `${DEFAULT}\n\n${ANTHROPIC}${tools.includes("todowrite") ? "\n\n# Task management\nUse todowrite to plan and track multi-step work. Mark tasks in progress when starting and completed as soon as they are finished." : ""}`,
    anthropic_without_todo: DEFAULT,
    trinity:
      TRINITY.replaceAll(
        "Run independent tool calls in parallel and dependent tool calls sequentially.",
        "Use exactly one tool call per assistant message. Wait for its result before selecting the next call.",
      ) + "\n\n${OPENCODE_TOOL_GUIDANCE}",
    gemini: `${DEFAULT}\n\n${GEMINI}`,
    ling: `${DEFAULT}\n\n${LING}`,
  }
  const template = prompt ? templates[prompt] : family.includes("kimi") ? KIMI : undefined
  return template === undefined ? undefined : SessionSystemPrompt.render(template, tools)
}
