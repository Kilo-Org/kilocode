---
title: "Mobile Apps"
description: "Using Kilo Code on iOS and Android"
---

# Mobile Apps

Use Kilo Code from your phone to keep coding sessions moving while you are away from your desk. The mobile app connects to Cloud Agents and remote sessions from your local CLI or editor extensions.

{% callout type="info" title="Android app available now" %}
Install Kilo Code for Android from [Google Play](https://play.google.com/store/apps/details?id=com.kilocode.kiloapp).
{% /callout %}

## What you can do

The mobile app lets you:

- View and manage Kilo Code sessions, including remote CLI and extension sessions running on your local machine.
- Spawn Cloud Agents and code directly from the app.
- Monitor and view all non-remote sessions in one place.
- Send follow-up messages while a session is still running — they are queued and processed in order.
- Run slash commands (like `/compact`) on connected remote CLI sessions, and start a new session in the same workspace with `/new`. The new session inherits the current session's mode and model. Older CLI versions that do not support remote commands prompt you to upgrade.
- Clear the visible transcript of a remote CLI session with `/clear`. Clearing is client-side only, so it works on any CLI version; server history is kept and may reappear when you re-enter the session.
- Exit a connected remote session with `/exit` or its alias `/quit`. Kilo asks you to confirm first, and a failed exit keeps a **Try again** row so you can retry after a dropped connection. The command is hidden when the connected CLI cannot exit sessions.
- Rename a remote CLI session from the app or the CLI — renames sync in both directions.
- Review GitHub pull requests end to end — diffs, checks, comments, and merging.
- Start a new session on a connected `kilo remote` CLI instance with the **Run on** picker.
- Track a session's goal in the session header, and start a goal with `/goal`.
- Approve one session's permission asks with the **Auto-approve** row in its context sheet.
- Collapse runs of consecutive tool calls with the **Condense tool calls** setting.

## Finding sessions

The **Agents** tab shows live sessions. Tap **See all** there to search past sessions, filter by platform or project, and change the sort order. **See all** on Home opens the live Agents list instead.

## Privacy and telemetry

On first launch, the app asks for your consent before enabling optional telemetry — product analytics, attribution, and performance tracing. Optional telemetry is pre-selected during onboarding; you can turn it off before accepting. No optional analytics starts before you make a choice.

You can review or change your decision at any time in **Settings**. Declining optional telemetry keeps you signed in, and optional telemetry state stored on the device is stopped and discarded when you revoke consent or sign out.

### App lock

Turn on **Unlock with biometrics** in **Settings > Preferences** to protect the app on this device. It asks you to unlock at launch and after five minutes in the background, with your device passcode available as a fallback. Locking hides your sessions and open sheets without discarding drafts or navigation.

### Links and images in chat

Images embedded in model replies stay hidden until you tap **Load**. The app shows the image's host first and only loads HTTPS images.

Web links in model replies ask you to confirm the destination host before opening. Choose **Trust this host** to skip future confirmations for that host. Review or revoke trusted hosts in **Preferences > Trusted hosts**; signing out clears the list. This confirmation applies to HTTP and HTTPS links, not other link types.

## Language and region

The app follows your device language, with English as the fallback. Choose another language from the login screen or **Preferences**. The picker supports search and shows languages in their own scripts. Dates, times, and currency formatting follow the selected language. Switching between left-to-right and right-to-left layouts restarts the app.

## Kilo Pass and billing

For Kilo Pass pricing, billing, and account management details, use the [Kilo Pass pricing page](https://kilo.ai/pricing/kilo-pass).

On Android, you can buy, restore, and change Kilo Pass tiers through Google Play. Tier changes take effect at the next renewal; your current tier and credits stay in place until then. Google manages cancellation and payment methods for passes purchased through Google Play.

{% imageGallery columns="3" width="220px" %}
{% image src="/docs/img/mobile-apps/home.webp" alt="Kilo Code mobile home screen showing active agent sessions" caption="Start coding tasks and resume active sessions from the mobile home screen." /%}

{% image src="/docs/img/mobile-apps/new-session.webp" alt="Kilo Code mobile new session screen with coding mode selector" caption="Create a new Cloud Agent session and choose the right mode for the task." /%}

{% image src="/docs/img/mobile-apps/session-chat.webp" alt="Kilo Code mobile session chat with an active coding task" caption="Review progress and continue coding conversations from the mobile app." /%}
{% /imageGallery %}

{% imageGallery columns="1" width="220px" %}
{% image src="/docs/img/mobile-apps/session-filters.webp" alt="Kilo Code mobile session filter panel for Cloud Extension CLI Slack and other platforms" caption="Filter sessions by platform and project, including Cloud, Extension, CLI, Slack, and other sessions." /%}
{% /imageGallery %}

## Choosing where a session runs

The new-session screen includes a **Run on** picker that chooses where your session runs:

- **Cloud Agent** — the managed cloud environment (the default).
- **A connected CLI instance**: a `kilo remote` CLI running on your own machine. The picker lists the instances currently connected to your account.

Remote sessions start with the mode and model selected on the new-session screen; older CLI versions that don't accept those fields fall back to their own defaults. By default, the workspace is the CLI's launch directory. Use **Folder** to choose a child folder, including nested folders, before starting. If the CLI cannot list folders, the app explains this and starts in the launch directory instead. In organization context, the new session belongs to that organization.

For Cloud Agent sessions, choose a repository from GitHub, GitLab, or, for organizations, Bitbucket. The picker groups repositories by provider and includes **Recently used**. Each provider has its own connection and error messages, so a problem with one does not hide the others.

## Continuing a finished session

Open a finished session and tap **Continue** to copy its conversation into a new session. The form starts with the source repository, mode, model, and reasoning variant. Choose **Cloud Agent** or a connected CLI in **Run on**, then tap **Start**.

The CLI must support importing sessions. If it does not, the app explains why and disables **Start** rather than creating an empty session. An unavailable model or repository also prevents starting until you choose an available option.

## Queueing follow-up messages

The composer stays editable while the agent is working, so you don't have to wait for a session to finish before sending your next message. Type your follow-up and press **Send** to add it to the session's queue; queued messages are processed in order. While a session is streaming, **Stop** appears only when the composer is empty — with text entered, Send takes its place.

A queued message shows a subtle **Queued** badge on its bubble. The badge clears when the message starts processing or when the queue drains or is cancelled. Queueing works for Cloud Agent sessions and for remote sessions on a connected `kilo remote` CLI instance.

## Auto-approve for one session

A session's **Context usage** sheet opens with an **Auto-approve** row at the top. Turn it on to approve that session's permission asks without a prompt, skip the permission card, and resolve an ask that is already waiting. Turn it off and the next permission ask shows its card again.

The row shows **On**, **Off**, or **Unavailable**, and warns that tools run without a prompt while it is on. Read-only sessions show the row disabled with the reason. The setting applies to one session only, so other sessions keep prompting. Clarification questions always show their card and are never auto-answered.

Auto-approve is kept in memory for the session and never changes your global auto-approve configuration. Signing out or switching accounts turns it off for every session.

## Condensing tool calls

Turn on **Condense tool calls** in **Settings > General** to collapse a run of consecutive tool calls into one row. The row reads `<n> items; <last call label>` and updates in place as calls stream in, showing the growing count and the last call's status. A message, thinking block, question, or other non-tool item ends the run, so the next tool calls start a new row.

Tapping the condensed row opens a **Tool calls** sheet that lists every call of the run in order. Each row keeps the same one-line label and status as the session page; tapping it opens that call's tool details.

The setting is off by default and stays on after an app restart. A lone tool call stays a normal row, and with the setting off the session page is unchanged. A tool call whose input cannot be read shows "Failed to render content" inline instead of breaking the session page.

## Hiding thinking details

Turn on **Hide thinking details** in **Settings > Preferences > General** to remove the agent's thinking rows, collapsed thinking items, and thinking text from the session page. It is off by default, is remembered across app relaunches, and applies to streaming and loaded sessions, including inside an opened subagent sheet.

Status labels still work while thinking is hidden: the composer spinner and a subagent sheet's footer read **Thinking** while reasoning streams, and a running subagent's task card shows **Thinking** instead of a stale activity. On a cold start with the setting on, Kilo draws no thinking row before the saved preference loads. A subagent sheet whose only message is reasoning shows no empty row.

## Voice input

Use the microphone in the composer to dictate a prompt. By default, the app uses your operating system's speech recognizer. To transcribe through your Kilo account instead, turn on **Gateway transcription** in **Preferences** and choose a transcription model. Your model choice is remembered across launches.

In gateway mode, the transcribed text appears in short segments while you speak instead of only after you stop. If a gateway upload fails mid-dictation, the error appears beside the field and the text already transcribed is kept. Dictation stops with an error if the saved transcription model cannot be read.

The selected engine handles the whole dictation; the app does not fall back to the other engine. Tap the microphone to cancel an in-progress transcription.

### Voice input language

The voice settings in **Preferences** include a **Language** row that shows **Automatic** or the chosen language. The picker in device mode lists the languages your device supports, and the picker in gateway mode lists the languages the app supports. Both include an **Automatic** row and a search box that matches language names without accents.

### Testing voice input

Voice settings include a **Test voice input** text area. Speak to append recognized speech live, use the microphone button to start or stop, and **Clear** to empty the field.

## Session goals

Sessions that report a goal show a fixed goal section under the session header. The section shows the goal status and objective, plus the reason supplied by the CLI when there is one.

| Status | Meaning |
|---|---|
| Active | The agent is working toward the objective. This state is visually emphasized. |
| Paused | The objective is saved but not running. |
| Complete | The agent reported the goal met. |
| Blocked | A request was rejected or execution was blocked. |

A session without a goal renders no section. Tap the section to **Edit**, **Pause** an active goal or **Resume** otherwise, or **Remove** the goal. Editing sends `/goal <objective>`; the other actions forward `/goal pause`, `/goal resume`, and `/goal clear`.

Selecting `/goal` with no argument starts goal compose mode, and the next send forwards `/goal <objective>`. A session whose catalog does not advertise `goal` shows an upgrade message instead of sending chat. See [Session Goals](/docs/code-with-ai/agents/goals) for the full command behavior.

## Attachments in remote sessions

When you connect the mobile app to a `kilo remote` CLI session, you can share files in both directions.

### Sending files from your phone to the CLI

Attach up to **5 files** (each up to **20 MiB**) from your phone to the remote session. The CLI automatically processes them:

- **Text, images, and PDFs** — the file content is converted to a `data:` URL and handed directly to the model as a file part. The model sees the content as if you had loaded it locally.
- **Other file types** (binaries, archives, etc.) — the file is saved to a per-session scratch directory on the CLI machine. The session transcript shows the saved path, filename, file size, and MIME type. The agent can inspect the file with the `read` tool for text content or shell utilities for binary content.

Attaching files from the phone is the mobile flow — this is separate from `kilo run --file <path>`, which attaches local files to a local prompt.

### Receiving files from the CLI on your phone

While the CLI is connected, the agent can deliver a file to your phone with the `send_file` tool (up to **4 MiB**, remote sessions only). The file appears as a chip on the tool card — tap the chip to open the share sheet and save or forward the file. This tool works only when `kilo remote` is actively connected; it is not available in Cloud Agent sessions.

## Reviewing GitHub pull requests

Open a pull request from a PR link to review it without leaving the app:

- **Overview**: PR state and CI checks at a glance.
- **Files** — syntax-highlighted diffs with line-level comments and a file navigator.
- **Discussion** — review threads with replies, resolve/unresolve, and reactions.

Comments you leave on diffs are collected into a pending review on your device and submitted to GitHub as a single review. To post a regular conversation comment instead, tap **Comment on this pull request** at the bottom of **Discussion**. These comments appear directly in the discussion and are not part of a review.

When the PR is ready, you can merge it (merge, squash, or rebase), enable or disable auto-merge, or update the branch, all from the app.

PR review uses your connected GitHub account; the app asks you to connect GitHub if you have not already.

## Session cost and model details

The app shows what each session cost and which models did the work:

- **Session list** — a finished session with a recorded cost shows it in the row's meta line (for example, `$0.12 · 5m ago`). Sessions that are still running or have no cost show no cost.
- **Cost breakdown** — open a session's Context usage sheet to see a Token usage section (input, output, reasoning, cache read, and cache write tokens, plus the cache hit rate) and a collapsible Models section with each model's name, provider, step count, and cost. A Subagents row covers any remaining spend, so the per-model costs always add up to the session total.
- **Per-message model label** — assistant messages show a dimmed model label on the first assistant reply and whenever the model changes during the session. Turns routed by [Auto Model](/docs/code-with-ai/agents/auto-model) show the concrete model that handled the turn.

Cost is recorded when a session closes; sessions that closed before this feature shipped do not show a cost.

## Widgets and live updates

Add the **Active Agents** widget to track **Needs input**, **Working**, and **Idle** session counts. Tap the widget to open your agents in the app. Background updates keep these surfaces informed while the app is not open; signing out stops updates for that account.

- **iOS**: widgets are available on the Home Screen and Lock Screen, with a Live Activity on the Lock Screen and Dynamic Island. Compact layouts prioritize agents that need input, then working agents, then idle agents. If Live Activities are disabled, the Agents tab offers a prompt to open device settings.
- **Android**: the resizable Home Screen widget shows **Needs input**, **Working**, and **Idle** counts at every size, including zeros while work is present. An ongoing **Active agents** notification also reports session activity. Supported devices can promote it to a Live Update. If notifications are disabled while work is pending, the app offers a prompt to enable them in device settings.

## Android App

The Android app is available now on Google Play.

[Install the Android app →](https://play.google.com/store/apps/details?id=com.kilocode.kiloapp)

## iOS App

The iOS app is in review with the App Store team and will be available soon. You can already sign up for the iOS waitlist to be notified when it launches.

[Join the iOS app waitlist →](https://kilo.ai/features/ios-app)
