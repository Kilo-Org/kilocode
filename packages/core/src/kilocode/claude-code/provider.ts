import { resolveBin } from "./cli"
import { ClaudeCodeLanguageModel } from "./language-model"

// Single source of truth for the model list, shared by BOTH places that
// register this provider: packages/opencode/src/kilocode/claude-code/provider.ts
// (the v1 models.dev-style catalog the shipping CLI actually resolves models
// through) and ./plugin.ts (the v2 core catalog, used by any consumer of
// @opencode-ai/core directly). A previous version of this file only lived in
// plugin.ts and drifted out of sync with the v1 catalog (stale aliases, old
// limits, no image/reasoning support) — importing from here instead of
// hand-copying keeps both registrations honest.
//
// Every id below is confirmed to work directly as `--model <id>` (not just
// via `opus`/`sonnet`/`haiku` alias resolution), and every context/output
// limit is read from the `modelUsage` field of a live `claude --model <id> ...`
// probe — verified live 2026-07-30/31, not hand-guessed. Anthropic ships new
// models over time and can retire old ones, so this list can go stale the
// same way a models.dev snapshot can; re-verify with the same probe technique
// if an entry ever looks off or starts failing.
//
// `claude-fable-5` is a real, CLI-recognized model — it echoes back correctly
// in the `result` event — but on this account it fails with HTTP 429 "Usage
// credits are required for this model" (`overageDisabledReason:
// "org_level_disabled"`), i.e. it sits outside the standard subscription's
// included usage and needs separate paid credits. Its limits below are an
// unverified placeholder (matched to the Opus 5-tier default) since the
// account can never actually reach a real `modelUsage` value for it.
export const MODELS = [
  { id: "claude-opus-4-1", name: "Claude Opus 4.1 (Claude Code)", context: 1_000_000, output: 64_000 },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Claude Code)", context: 200_000, output: 64_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Claude Code)", context: 1_000_000, output: 64_000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-opus-5", name: "Claude Opus 5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5 (Claude Code, requires separate credits)",
    context: 200_000,
    output: 32_000,
  },
]

export type ProviderOptions = {
  /** Provider id used for telemetry/labels; supplied by AISDK.prepareOptions. */
  name?: string
  /** Override the discovered CLI path (mainly for tests). */
  bin?: string
  /** Working directory the CLI runs in; scopes @-file resolution. */
  cwd?: string
  env?: Record<string, string>
}

export type ClaudeCodeProvider = {
  (modelID: string): ClaudeCodeLanguageModel
  languageModel: (modelID: string) => ClaudeCodeLanguageModel
}

export function createClaudeCode(options: ProviderOptions = {}): ClaudeCodeProvider {
  const create = (modelID: string) => {
    const bin = options.bin ?? resolveBin()
    if (!bin)
      throw new Error(
        "Claude Code CLI not found. Install it from https://claude.com/product/claude-code, or set KILO_CLAUDE_CODE_PATH.",
      )
    return new ClaudeCodeLanguageModel(modelID, {
      provider: options.name ?? "claude-code",
      bin,
      cwd: options.cwd,
      env: options.env,
    })
  }
  const provider = ((modelID: string) => create(modelID)) as ClaudeCodeProvider
  provider.languageModel = create
  return provider
}
