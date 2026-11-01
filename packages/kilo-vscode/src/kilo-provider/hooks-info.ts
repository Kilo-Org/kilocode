import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { HooksInfoLoadedMessage } from "../../webview-ui/src/types/messages"

/**
 * Data for the Hooks settings tab: the Claude Code hooks the server runs (for every event it imports
 * from ~/.claude/settings.json), the events and handlers it skips with the reason, and the tool
 * names matchers can use.
 */
export async function loadHooksInfo(client: KiloClient, dir: string): Promise<HooksInfoLoadedMessage> {
  const { data } = await client.config.hooks({ directory: dir }, { throwOnError: true })
  return {
    type: "hooksInfoLoaded",
    claude: {
      path: data.claude.path,
      enabled: data.claude.enabled,
      ...(data.claude.hooks ? { hooks: data.claude.hooks } : {}),
      skipped: data.claude.skipped,
    },
    tools: data.tools,
  }
}
