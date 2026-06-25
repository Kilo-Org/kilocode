import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://relay.dev",
  "X-Title": "Relay",
  "User-Agent": `Relay/${InstallationVersion}`,
}
