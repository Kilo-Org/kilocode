import type { KiloClient } from "@kilocode/sdk/v2/client"

/** Data for the Hooks settings tab: the Claude Code hooks the server runs and the tool names matchers can use. */
export async function loadHooksInfo(client: KiloClient, dir: string) {
  const { data } = await client.config.hooks({ directory: dir }, { throwOnError: true })
  return { type: "hooksInfoLoaded" as const, claude: data.claude, tools: data.tools }
}
