# Kilo Desktop Slack MCP Prototype

This prototype connects Kilo Desktop to Slack's hosted MCP server using a
Slack app identity and per-user OAuth with PKCE.

## Product Direction

Kilo already has a customer-facing Slack app and OAuth installation flow.
The production direction should extend that app so it supports both:

1. Kilo in Slack: Slack messages invoke Kilo and Cloud Agents.
2. Slack in Kilo: Kilo Desktop agents search and read Slack context.

Do not create a second public Kilo listing unless Slack or the current app's
architecture makes reuse impossible.

## Safety Boundary

Do not apply `slack-app-manifest.json` to the production Kilo Slack app.
Enabling PKCE marks a Slack app as a public OAuth client and cannot be undone
without Slack Support. Clone the current app or create a staging app first.

The distributed desktop configuration contains a public Slack Client ID only.
It must never contain a Slack Client Secret. PKCE protects the authorization
code exchange for native clients.

## Prototype Setup

1. Create a Slack Developer Program sandbox or development workspace.
2. Create a staging app from `slack-app-manifest.json`.
3. Confirm **Agents & AI Apps > Model Context Protocol** is enabled. If the
   manifest does not apply the toggle, enable it manually.
4. Install the staging app to the development workspace.
5. Copy its Client ID into `kilo.prototype.json`.
6. Copy `kilo.prototype.json` to a test Kilo profile, then set
   `mcp.slack.enabled` to `true`.
7. Restart Kilo and complete Slack authorization in the browser.
8. On Enterprise Grid, select the specific workspace rather than the Grid
   organization during user authorization.

Kilo's OAuth implementation already stores a PKCE code verifier and defaults
to `http://127.0.0.1:19876/mcp/oauth/callback`. The prototype explicitly uses
`localhost` because Slack documents localhost redirects as desktop redirects
when PKCE is enabled. If Slack requires exact host matching, use the same host
in both the Slack manifest and Kilo configuration.

## Slack Scope

The prototype can:

- Search public channels.
- Search private channels the authenticated user belongs to.
- Search and read direct messages and group direct messages the authenticated
  user can access.
- Read public and user-accessible private channel history and threads.
- Search and read files.
- Resolve channels and users.
- Draft messages without publishing them.
- Publish messages to channels, threads, direct messages, and group direct
  messages after the user explicitly chooses **Draft and publish**.

Before writing, Kilo asks the user to choose **Draft only** or
**Draft and publish**. Draft-only responses stay in Kilo and do not invoke a
Slack write tool. Published messages always end with `Written by Kilo`; the
runtime appends this attribution at the execution boundary if needed.

It intentionally excludes reactions, uploads, channel creation, canvases,
and lists.

Private scopes never grant access to private channels the user has not joined.

## Validation

1. Kilo reports the `slack` MCP server as connected.
2. Tool discovery succeeds against `https://mcp.slack.com/mcp`.
3. Search finds a known message in a public test channel.
4. Search finds a known message in a private channel joined by the test user.
5. Search cannot find content from a private channel the test user has not
   joined.
6. Channel and thread retrieval preserve author, timestamp, channel, and
   message links so Kilo can cite its answers.
7. No write-capable Slack tools can execute without explicit approval.
8. Disconnecting or revoking the Slack app makes subsequent calls fail cleanly.
9. Reauthorization and refresh-token rotation work after restart.

## Production Follow-Up

- Inspect the existing Kilo Slack app and backend before deciding whether to
  add PKCE to it or create a successor app.
- Add a first-class **Connect Slack** control to Kilo Desktop rather than
  asking customers to edit JSON.
- Store tokens in the OS credential store, not plaintext configuration.
- Decide whether the same per-user Slack authorization can be shared with the
  existing `app.kilo.ai` integration without broadening data retention.
- Document retention, deletion, customer controls, and audit behavior.
- Submit the updated app and MCP-client experience for Slack Marketplace
  review. Slack documents up to 10 business days for preliminary review and
  up to 10 weeks for functional review after assignment.

## Browser Capability

Kilo's browser-based Cloud Agent does not currently provide general native MCP
support according to the current product documentation, which says MCP support
is coming. Browser users can control a local Kilo CLI session through Remote
Connections; that local session can use Slack MCP, but the local machine must
remain running.

The hosted browser product can gain direct Slack access later by reusing the
same approved Slack app while running the OAuth callback and MCP connection in
Kilo's cloud infrastructure. Unlike Desktop, the hosted flow can keep a client
secret server-side, though a unified PKCE implementation may be preferable.

## Sources

- Slack MCP server: https://docs.slack.dev/ai/slack-mcp-server
- Slack PKCE: https://docs.slack.dev/authentication/using-pkce
- Kilo MCP OAuth implementation:
  https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/mcp/oauth-provider.ts
- Existing Kilo for Slack:
  https://kilo.ai/docs/code-with-ai/platforms/slack
- Kilo Cloud Agent limitations:
  https://kilo.ai/docs/code-with-ai/platforms/cloud-agent
