# PR #9764 Security Review Notes

Scope: `review/pr-9764` compared with `origin/main...HEAD`. Research-only review focused on KiloClaw chat changes, indirect prompt injection, private repository exposure, and unauthenticated bot invocation.

## Findings

### High: KiloClaw action approvals can be executed from chat without showing the underlying privileged action

The VS Code KiloClaw chat UI renders `actions` blocks as generic buttons and forwards the selected value directly to the chat worker. The local UI does not display the underlying command, working directory, repository, resolved binary, or any other approval context before executing `allow-once` / `allow-always`.

Relevant references:

- `packages/kilo-vscode/src/kiloclaw/types.ts:51` defines `ActionsBlock` with only `groupId`, labels, styles, and decision values.
- `packages/kilo-vscode/webview-ui/kiloclaw/components/MessageBubble.tsx:322` renders action buttons from the message content.
- `packages/kilo-vscode/webview-ui/kiloclaw/components/MessageBubble.tsx:347` calls `props.onExecuteAction(...)` directly when a button is clicked.
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:263` posts `kiloclaw.executeAction` to the extension host.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:951` handles `executeAction`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:974` sends the action to `/execute-action`.

Why this matters:

- KiloClaw instances can run with broad capabilities. Docs state the default profile gives access to filesystem operations, shell execution, web search, browser automation, messaging, memory, sub-agents, and more (`packages/kilo-docs/pages/kiloclaw/overview.md:82`, `packages/kilo-docs/pages/kiloclaw/overview.md:86`).
- GitHub integration commonly grants repository write, PR write, issue write, and workflow write permissions (`packages/kilo-docs/pages/kiloclaw/development-tools/github.md:28`, `packages/kilo-docs/pages/kiloclaw/development-tools/github.md:40`, `packages/kilo-docs/pages/kiloclaw/development-tools/github.md:44`).
- Exec approvals elsewhere are described as showing command, args, cwd, agent ID, and resolved path (`packages/kilo-docs/pages/kiloclaw/control-ui/exec-approvals.md:64`), but this new chat action surface does not appear to carry or display that context.

Attack scenario:

1. An attacker lands prompt-injection text in content the bot later reads indirectly, such as a commit message, PR body, issue comment, webhook payload, repository file, Slack message, or other committed/chat context.
2. The bot is induced to request a privileged action.
3. The user sees a generic chat approval button and clicks it without seeing the actual command or repository effect.
4. The approval may persist if the value is `allow-always`.

Recommended mitigation:

- Do not render executable approval actions unless the action block includes trusted, server-signed approval details.
- Show command, args, cwd, repository/target, resolved binary/path, persistence effect, and whether the approval is one-time or persistent.
- Require an additional confirmation for `allow-always`.
- Treat action labels and surrounding markdown as untrusted; never rely on them as the security explanation.

### High: Indirect prompt injection through webhook or repository content can drive a highly privileged KiloClaw agent

KiloClaw supports webhooks that render arbitrary external payloads into chat messages for the agent. The default webhook template includes the raw JSON payload, and the docs explicitly describe GitHub webhooks as a use case.

Relevant references:

- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:8` says webhook payloads are rendered through a prompt template and delivered as chat messages.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:24` describes external HTTP POSTs becoming KiloClaw chat messages.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:36` shows the default prompt including `{{bodyJson}}`.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:94` documents GitHub push notifications as an example.
- `packages/kilo-docs/pages/kiloclaw/overview.md:86` says new KiloClaw instances default to the full tool profile.
- `packages/kilo-docs/pages/kiloclaw/development-tools/github.md:8` describes autonomous cloning, pushing, PRs, and code reviews.

Why this matters:

- An attacker does not need to directly message or authenticate to the bot if they can control content that is later included in bot context.
- GitHub commit messages, PR bodies, issue text, branch names, filenames, diffs, and webhook payloads are common prompt-injection carriers.
- With a GitHub PAT and full tool profile, successful injection could cause repository writes, PR manipulation, workflow changes, or data exfiltration.

Recommended mitigation:

- `SECURITY.md` should explicitly classify indirect prompt injection through repository/webhook/chat content as in-scope when it causes privilege escalation or data exfiltration beyond the attacker's original rights.
- KiloClaw should wrap untrusted webhook/repository content in strong delimiters with system instructions that it is data, not instructions.
- High-risk actions from indirect contexts should require a human approval UI that shows exact effects and source provenance.
- Consider separate trust levels for direct owner chat, authenticated collaborator chat, webhook payloads, and repository-derived content.

### High: `/kilo/claw/chat-credentials` returns the user's existing long-lived Kilo token to local clients

The new chat credentials route returns the existing Kilo bearer token, not a short-lived token scoped only to chat or to a single sandbox/conversation.

Relevant references:

- `packages/kilo-gateway/src/server/routes.ts:585` defines `/claw/chat-credentials`.
- `packages/kilo-gateway/src/server/routes.ts:589` says the route returns the bearer token used for Kilo Chat and Event Service.
- `packages/kilo-gateway/src/server/routes.ts:590` says the bearer is the user's existing long-lived Kilo JWT.
- `packages/kilo-gateway/src/server/routes.ts:615` reads local Kilo auth.
- `packages/kilo-gateway/src/server/routes.ts:617` accepts either API key or OAuth access token.
- `packages/kilo-gateway/src/server/routes.ts:626` gives API tokens a one-year placeholder expiry.
- `packages/kilo-gateway/src/server/routes.ts:628` returns the token, chat URL, and event-service URL.
- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:76` fetches these credentials.
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:224` sends the token as `Authorization: Bearer`.

Why this matters:

- Any client with access to the local CLI server endpoint can obtain a reusable Kilo token and invoke cloud chat APIs directly.
- This expands the impact of local server exposure from "control this local server" to "obtain a cloud bearer credential".
- If the local server is accidentally unauthenticated or exposed, this may allow sending messages, reading conversations, executing actions, or accessing other Kilo APIs depending on token scope.
- `SECURITY.md` currently says unauthenticated opted-in server mode is out of scope, but this PR makes the local server a broker for long-lived cloud credentials, which may deserve explicit handling.

Recommended mitigation:

- Do not return the raw Kilo OAuth/API token from the local gateway.
- Mint a short-lived, audience-restricted token for Kilo Chat/Event Service.
- Scope the token to the current user, organization, sandbox ID, and allowed chat operations.
- Prevent action execution with a chat token unless the action is separately authorized.
- Redact these tokens from logs and SDK error paths.

### Medium/High: Organization and private-repo isolation for chat credentials is not explicit

`/claw/status` forwards the selected organization ID to the Kilo API, but `/claw/chat-credentials` returns only the bearer token and service URLs. The subsequent Kilo Chat requests do not include an explicit organization header or sandbox-bound credential in this client code.

Relevant references:

- `packages/kilo-gateway/src/server/routes.ts:561` derives `organizationId` for `/claw/status`.
- `packages/kilo-gateway/src/server/routes.ts:566` forwards `HEADER_ORGANIZATIONID` on `/claw/status`.
- `packages/kilo-gateway/src/server/routes.ts:615` starts `/claw/chat-credentials`.
- `packages/kilo-gateway/src/server/routes.ts:628` returns token and URLs without organization or sandbox binding.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:332` stores the `sandboxId` from status.
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:78` allows listing conversations with an optional `sandboxId`.
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:154` lists messages by `conversationId` only.
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:160` executes actions by `conversationId` and `messageId`.

Why this matters:

- Users can belong to multiple organizations and may have private repositories or KiloClaw instances in different org contexts.
- If Kilo Chat/Event Service derives tenancy only from the user token and not the selected org/sandbox, chat messages or action execution could cross org boundaries.
- Conversation IDs and sandbox IDs are treated as routing identifiers in the client; server-side authorization must not rely on secrecy of those IDs.

Recommended mitigation:

- Verify server-side Kilo Chat and Event Service authorization checks enforce user + organization + sandbox + conversation membership on every request.
- Include the active organization and sandbox in the minted chat token, not just in client request parameters.
- Make `sandboxId` mandatory for list/create and verify all conversation/message/action endpoints belong to that sandbox.
- Add tests for cross-org users with multiple KiloClaw instances and private repositories.

### Medium/High: Event Service context subscription authorization must be verified server-side

The Event Service client subscribes to string contexts such as `/kiloclaw/{sandboxId}` and `/kiloclaw/{sandboxId}/{conversationId}`. The client authenticates with the same bearer token but does not provide additional proof of membership in the context.

Relevant references:

- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:129` subscribes to provided contexts.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:184` encodes the bearer token into the WebSocket subprotocol.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:285` dispatches events based on the server-provided `context`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:489` subscribes to `/kiloclaw/${sandboxId}`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:501` subscribes to `/kiloclaw/${sandboxId}/${conversationId}`.
- `packages/opencode/src/kilocode/claw/client.ts:151` uses the same sandbox context pattern in the TUI.
- `packages/opencode/src/kilocode/claw/client.ts:251` uses the same conversation context pattern in the TUI.

Why this matters:

- If Event Service only validates that a token is valid, an authenticated user who learns or guesses another context could subscribe to private chat events.
- Chat events may include message contents, approval prompts, bot status, context-token metadata, and private repo-derived content.

Recommended mitigation:

- Server-side Event Service must authorize every `context.subscribe` request against token subject, organization, sandbox, and conversation membership.
- Context names should not be treated as secrets.
- Prefer server-issued subscription tokens scoped to exact context prefixes.
- Add tests that a user cannot subscribe to another user's or another organization's KiloClaw contexts.

### Medium: Webhook URLs can invoke the bot without authentication unless optional auth is enabled

KiloClaw webhook URLs are bearer credentials. Authentication via shared secret header is optional.

Relevant references:

- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:16` says KiloClaw generates a unique webhook URL.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:18` warns the URL is a secret.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:19` says anyone with the URL can send messages to the instance.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:75` describes webhook authentication as optional.
- `packages/kilo-docs/pages/kiloclaw/triggers/webhooks.md:86` says authentication is optional because the URL itself is a credential.

Why this matters:

- This is an unauthenticated bot invocation path by design.
- URL leaks are common through logs, analytics, referrers, screenshots, issue reports, and repository commits.
- Combined with full tool profile and GitHub credentials, this can become a privilege escalation path from "knows URL" to "can influence privileged agent actions".

Recommended mitigation:

- `SECURITY.md` should explicitly warn that webhook URLs are credentials and that leaked URLs can invoke the bot.
- Consider making shared-secret authentication default-on for high-risk integrations like GitHub.
- Rate limit webhook invocations and surface source/provenance in the chat UI.
- Treat webhook-originated messages as untrusted and require stronger approvals for privileged actions.

## Private Repository Exposure Checklist

Human reviewers should verify the following before merging:

- Kilo Chat stores and transmits private repo-derived message content only under the correct user/org tenancy.
- Event Service subscriptions cannot cross user, org, sandbox, or conversation boundaries.
- `/claw/chat-credentials` cannot be used to obtain a token for a different org context.
- Conversation IDs cannot be used as bearer capabilities.
- Approval actions cannot operate on repositories outside the expected bot account/org scope.
- Webhook payload capture pages and chat transcripts do not expose private GitHub payloads to other users/orgs.
- Logs do not include returned Kilo JWTs, webhook URLs, private repo content, command approvals, or action payloads.

## Suggested Security Scope Language

Add or adapt this language in `SECURITY.md`:

```md
### KiloClaw, Webhooks, and Indirect Prompt Injection

KiloClaw agents can run with powerful integrations such as shell execution, browser automation, messaging platforms, and GitHub repository access. Reports are in scope when an attacker can cause the agent to take actions beyond the attacker's original privileges by placing instructions in content that is later included in the agent's context, including but not limited to commits, pull requests, issues, comments, webhook payloads, chat messages, calendar/email content, webpages, or repository files.

Webhook URLs are bearer credentials. Anyone with a valid webhook URL may be able to deliver messages to the associated KiloClaw instance unless additional webhook authentication is enabled. Leaked webhook URLs that allow unauthorized invocation of a privileged bot are in scope.

Private repository leakage is in scope when KiloClaw, Kilo Chat, Event Service, or related approval flows expose private repository content, chat transcripts, webhook payloads, credentials, or action details across users, organizations, sandboxes, conversations, or unauthenticated clients.

Action approval bypasses are in scope when an attacker can cause a user to approve a privileged command or persistent permission without a trustworthy display of the command, target, repository, working directory, or persistence effect.
```
