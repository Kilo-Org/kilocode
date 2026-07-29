---
title: "Mobile Apps"
description: "Using Kilo Code on iOS and Android"
---

# Mobile Apps

Use Kilo Code from your phone to keep coding sessions moving while you are away from your desk. The mobile app connects to Cloud Agents, KiloClaw, and remote sessions from your local CLI or editor extensions.

{% callout type="info" title="Android app available now" %}
Install Kilo Code for Android from [Google Play](https://play.google.com/store/apps/details?id=com.kilocode.kiloapp).
{% /callout %}

## What you can do

The mobile app lets you:

- View and manage Kilo Code sessions, including remote CLI and extension sessions running on your local machine.
- Send follow-up messages while a session is still running — they are queued and processed in order.
- Attach files from your device to messages in Cloud Agent and remote CLI sessions.
- Share text, links, images, and documents from other apps into a session via the iOS and Android share sheets.
- Run slash commands (like `/compact`) on connected remote CLI sessions, start a new session in the same workspace with `/new`, and exit a session with `/exit` — exiting stops the running session but keeps its history, and the CLI keeps running. Older CLI versions that do not support remote commands prompt you to upgrade.
- Review GitHub pull requests end to end — diffs, checks, comments, and merging.
- Start a new session on a connected `kilo remote` CLI instance with the **Run on** picker.
- Chat with KiloClaw from your phone.
- Spawn Cloud Agents and code directly from the app.
- Monitor and view all non-remote sessions in one place.
- Preview the files the agent reads, right from the session's tool cards — markdown files render inline and expand into a full-screen reader, and images and screenshots open in a pinch-zoom viewer.
- Create, onboard, and manage KiloClaw instances.

## Reviewing GitHub pull requests

Open a pull request from a PR link to review it without leaving the app:

- **Overview** — PR state and CI checks at a glance.
- **Files** — syntax-highlighted diffs with line-level comments and a file navigator.
- **Discussion** — review threads with replies, resolve/unresolve, and reactions.

Comments you leave are collected into a pending review on your device and submitted to GitHub as a single review. When the PR is ready, you can merge it (merge, squash, or rebase), enable or disable auto-merge, or update the branch — all from the app.

PR review uses your connected GitHub account; the app asks you to connect GitHub if you have not already.

## Choosing where a session runs

The new-session screen includes a **Run on** picker that chooses where your session runs:

- **Cloud Agent** — the managed cloud environment (the default).
- **A connected CLI instance** — a `kilo remote` CLI running on your own machine. The picker lists the instances currently connected to your account.

Remote sessions use the CLI's own defaults, so the composer skips model, mode, and repository selection; you type your first prompt in the chat after the session starts. Sessions started in an organization context always run on the Cloud Agent, so the picker does not appear there.

## Attaching files

Attach files from your device to any message — attachments work in both Cloud Agent sessions and remote sessions on a connected `kilo remote` CLI instance.

- Send up to **5 files per message**, each up to **5 MB**.
- Images and PDFs are sent with the message so the model can see them directly. Other file types (documents, spreadsheets, archives, and so on) are uploaded to the session's workspace, and the agent reads them from there.
- Executable and installer formats are blocked: `.exe`, `.dll`, `.msi`, `.com`, `.scr`, `.apk`, `.ipa`, `.dmg`, `.pkg`.

Kilo Chat conversations with your [KiloClaw](/docs/kiloclaw/chat-platforms) also accept attachments, up to **10 MB per file**. The app checks the size when you pick the file and rejects oversized files with a toast, before anything is uploaded.

## Sharing into Kilo from other apps

Kilo appears as a share target in the iOS and Android share sheets, so you can send content from other apps straight into a session. Sharing accepts plain text, URLs, images, and documents — the same types the new-session composer accepts, subject to the same [attachment limits](#attaching-files).

Sharing into Kilo opens a preview where you check the content and choose where it goes — a **new session** or an **existing session**, on a Cloud Agent or a connected `kilo remote` CLI instance. Nothing is sent until you confirm. Destinations that can't accept the payload — for example a CLI that is offline, or a remote session that can't receive files when you've shared files — stay listed, but tapping them explains why they're unavailable instead of dropping your content.

## Queueing follow-up messages

The composer stays editable while the agent is working, so you don't have to wait for a session to finish before sending your next message. Type your follow-up and press **Send** to add it to the session's queue; queued messages are processed in order. While a session is streaming, **Stop** appears only when the composer is empty — with text entered, Send takes its place.

A queued message shows a subtle **Queued** badge on its bubble. The badge clears when the message starts processing or when the queue drains or is cancelled. Queueing works for Cloud Agent sessions and for remote sessions on a connected `kilo remote` CLI instance.

## Session cost and model details

The app shows what each session cost and which models did the work:

- **Session list** — a finished session with a recorded cost shows it in the row's meta line (for example, `$0.12 · 5m ago`). Sessions that are still running or have no cost show no cost.
- **Cost breakdown** — open a session's Context usage sheet to see a Token usage section (input, output, reasoning, cache read, and cache write tokens, plus the cache hit rate) and a collapsible Models section with each model's name, provider, step count, and cost. A Subagents row covers any remaining spend, so the per-model costs always add up to the session total.
- **Per-message model label** — assistant messages show a dimmed model label on the first assistant reply and whenever the model changes during the session. Turns routed by [Auto Model](/docs/code-with-ai/agents/auto-model) show the concrete model that handled the turn.

Cost is recorded when a session closes; sessions that closed before this feature shipped do not show a cost.

## Notification preferences

Open the **Notifications** screen from the Profile tab to choose which push notifications you receive. The screen requires system notification permission and a registered device; after that, you can toggle each category independently:

- **Chat messages** — new messages in your Kilo chat conversations
- **Agent attention** — sessions waiting on your input, such as questions or permission requests
- **Agent updates** — general agent progress updates
- **Session status** — session lifecycle events, such as completions
- **KiloClaw activity** — activity from your KiloClaw instances
- **Balance alerts** — an organization's balance dropping below its configured minimum; tapping the notification opens that organization's credit activity
- **Security findings** — new Security Agent findings and SLA warnings or breaches; tapping the notification opens the finding

Preferences are stored per account and enforced server-side, so a category you turn off is suppressed on every device. The toggles affect only push notifications — email alerts, such as Security Agent notification emails, are still delivered when a category is off.

## Appearance

Choose how the app looks from the **Appearance** section of the Profile tab: **System** (the default, which follows your device's theme), **Light**, or **Dark**. Your choice applies across the whole app and is stored on the device, so it survives signing out.

## Kilo Pass and Billing

For Kilo Pass pricing, billing, and account management details, use the [Kilo Pass pricing page](https://kilo.ai/pricing/kilo-pass).

{% imageGallery columns="3" width="220px" %}
{% image src="/docs/img/mobile-apps/home.webp" alt="Kilo Code mobile home screen showing KiloClaw and active agent sessions" caption="Start coding tasks, open KiloClaw, and resume active sessions from the mobile home screen." /%}

{% image src="/docs/img/mobile-apps/new-session.webp" alt="Kilo Code mobile new session screen with coding mode selector" caption="Create a new Cloud Agent session and choose the right mode for the task." /%}

{% image src="/docs/img/mobile-apps/session-chat.webp" alt="Kilo Code mobile session chat with an active coding task" caption="Review progress and continue coding conversations from the mobile app." /%}
{% /imageGallery %}

{% imageGallery columns="2" width="220px" %}
{% image src="/docs/img/mobile-apps/kiloclaw-chat.webp" alt="KiloClaw chat in the Kilo Code mobile app" caption="Chat with KiloClaw on mobile." /%}

{% image src="/docs/img/mobile-apps/session-filters.webp" alt="Kilo Code mobile session filter panel for Cloud Extension CLI Slack and other platforms" caption="Filter sessions by platform and project, including Cloud, Extension, CLI, Slack, and other sessions." /%}
{% /imageGallery %}

## Android App

The Android app is available now on Google Play.

[Install the Android app →](https://play.google.com/store/apps/details?id=com.kilocode.kiloapp)

## iOS App

The iOS app is in review with the App Store team and will be available soon. You can already sign up for the iOS waitlist to be notified when it launches.

[Join the iOS app waitlist →](https://kilo.ai/features/ios-app)
