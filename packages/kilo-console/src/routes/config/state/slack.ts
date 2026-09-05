import type { McpRemoteConfig } from "@kilocode/sdk/v2/client"

export const slackId = "slack"
export const slackUrl = "https://mcp.slack.com/mcp"
export const slackRedirect = "http://localhost:19876/mcp/oauth/callback"
export const slackScope = [
  "search:read.public",
  "search:read.private",
  "search:read.im",
  "search:read.mpim",
  "search:read.files",
  "search:read.users",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "im:write",
  "mpim:write",
  "chat:write",
  "files:read",
  "users:read",
].join(" ")

export function slack(client: string): McpRemoteConfig {
  return {
    type: "remote",
    url: slackUrl,
    enabled: true,
    timeout: 30_000,
    oauth: {
      clientId: client.trim(),
      scope: slackScope,
      redirectUri: slackRedirect,
    },
  }
}
