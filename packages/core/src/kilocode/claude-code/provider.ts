import { resolveBin } from "./cli"
import { ClaudeCodeLanguageModel } from "./language-model"

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
