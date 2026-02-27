import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"

// kilocode_change start
import SOUL from "../kilocode/soul.txt"
import { editorContextEnvLines, type EditorContext } from "../kilocode/editor-context"
// kilocode_change end

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  // kilocode_change start
  export function soul() {
    return SOUL.trim()
  }
  // kilocode_change end

  export function provider(model: Provider.Model) {
    // kilocode_change start
    switch (model.prompt) {
      case "anthropic":
        return [PROMPT_ANTHROPIC]
      case "anthropic_without_todo":
        return [PROMPT_ANTHROPIC_WITHOUT_TODO]
      case "beast":
        return [PROMPT_BEAST]
      case "codex":
        return [PROMPT_CODEX]
      case "gemini":
        return [PROMPT_GEMINI]
      case "trinity":
        return [PROMPT_TRINITY]
    }
    // kilocode_change end

    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]

    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  // kilocode_change start
  export async function environment(model: Provider.Model, editorContext?: EditorContext) {
    // kilocode_change end
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        ...editorContextEnvLines(editorContext), // kilocode_change
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }
}
