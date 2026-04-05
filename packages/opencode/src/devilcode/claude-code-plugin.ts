import type { Hooks, PluginInput } from "@devilcode/plugin"
import { CLAUDE_CODE_ID, CLAUDE_CODE_KEY, CLAUDE_CODE_URL, wait } from "./claude-code"

export async function ClaudeCodeAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: CLAUDE_CODE_ID,
      methods: [
        {
          type: "oauth",
          label: "Use local Claude Code",
          async authorize() {
            return {
              url: CLAUDE_CODE_URL,
              instructions: "Install Claude Code if needed, then run `claude` in a terminal to sign in.",
              method: "auto" as const,
              async callback() {
                await wait({
                  cwd: input.directory,
                })
                return {
                  type: "success" as const,
                  key: CLAUDE_CODE_KEY,
                }
              },
            }
          },
        },
      ],
    },
  }
}
