import type { KiloClient } from "@kilocode/sdk/v2/client"

/** Claude Code user hooks as the running server would run them, for the Hooks settings tab. */
export async function loadClaudeHooks(client: KiloClient, dir: string) {
  const { data } = await client.config.claudeHooks({ directory: dir }, { throwOnError: true })
  return { type: "claudeHooksLoaded" as const, path: data.path, enabled: data.enabled, hooks: data.hooks }
}
