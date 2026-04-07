---
title: "Google Workspace Integration"
description: "Connect a dedicated Google account to DevilClaw for access to Gmail, Calendar, Drive, Docs, Sheets, and more"
---

# Google Workspace Integration

Connect a dedicated Google account to DevilClaw so it can interact with Google Workspace services — Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, People, Forms, Chat, Classroom, and Apps Script.

{% callout type="warning" title="Use a standalone Google account" %}
We strongly recommend creating a **dedicated Google account** specifically for DevilClaw rather than connecting your personal Google account. This keeps your personal data separate and gives you full control over what DevilClaw can access. Throughout this guide, "the DevilClaw Google account" refers to this dedicated account.
{% /callout %}

## What You Get

Once setup is complete, your DevilClaw machine will have the following configured automatically:

- The [`gog` CLI](/docs/DevilClaw/pre-installed-software) pre-loaded with the DevilClaw Google account's credentials, giving the agent access to 12+ Google APIs
- Real-time Gmail push notifications via Google Pub/Sub, so DevilClaw can react to incoming emails sent to the dedicated account without polling
- Access to the full range of Google Workspace services:

| Service               | What DevilClaw can do         |
| --------------------- | ---------------------------- |
| **Gmail**             | Read, draft, and send emails |
| **Google Calendar**   | View and manage events       |
| **Google Drive**      | Access and organize files    |
| **Google Docs**       | Read and edit documents      |
| **Google Sheets**     | Read and edit spreadsheets   |
| **Google Slides**     | Read and edit presentations  |
| **Google Tasks**      | View and manage tasks        |
| **People (Contacts)** | Access contact information   |
| **Google Forms**      | Read and manage forms        |
| **Google Chat**       | Send and read messages       |
| **Google Classroom**  | Access classroom resources   |
| **Apps Script**       | Manage Apps Script projects  |

## Prerequisites

Before you begin, make sure you have:

- **Docker** installed and running on your machine

## Setup

{% youtube url="https://youtu.be/PX444_j3O4I" title="Google Workspace Setup Guide" caption="How to connect your Google account to DevilClaw" /%}

1. Go to the **Settings** tab on your [DevilClaw dashboard](/docs/DevilClaw/dashboard)
2. Find the **Google Account** section
3. Copy the provided `docker run` command — it includes a short-lived authentication token
4. Paste the command into a terminal on your local machine and run it

The container launches an interactive setup flow. Follow the on-screen prompts — you will need to switch to a web browser at several points during the process.

## Using Google Services

Once setup is complete, DevilClaw can interact with Google Workspace services using the dedicated account. You can issue natural language prompts directly. For example:

- "Check your Gmail inbox for unread messages"
- "Create a new Google Doc summarizing our meeting notes"
- "Add a meeting to your calendar for tomorrow at 2pm"
- "List recent files in your Google Drive"

DevilClaw will automatically use the dedicated account's credentials to fulfill these requests.

### Accessing your personal Google data

DevilClaw's credentials are tied to its dedicated Google account — not your personal one. To let DevilClaw work with your personal Google data, you need to **share or delegate access from your personal account to the DevilClaw account**:

| Service                           | How to share access                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Google Calendar**               | Share your calendar with the DevilClaw account's email address ([instructions](https://support.google.com/calendar/answer/37082))                                                                       |
| **Google Drive**                  | Share specific files or folders with the DevilClaw account's email address                                                                                                                              |
| **Gmail** (Option 1: Delegation)  | Set up [Gmail delegation](https://support.google.com/mail/answer/138350) to grant DevilClaw read and write access to your inbox — it can read, draft, and send emails on your behalf                    |
| **Gmail** (Option 2: Forwarding)  | Set up [email forwarding](https://support.google.com/mail/answer/10957) so DevilClaw receives its own copy of all incoming emails — it can read them but cannot make any changes to your original inbox |
| **Google Docs / Sheets / Slides** | Share individual documents with the DevilClaw account's email address                                                                                                                                   |

Once access is shared, reference the delegation in your prompts so DevilClaw knows where to look:

- "Check the shared calendar from alice@example.com for tomorrow's meetings"
- "Open the Q3 report shared with you from the team Drive"
- "Read the latest emails in the delegated inbox from alice@example.com"
- "Draft a reply in the delegated Gmail from alice@example.com to the last message from Bob"

## Related

- [DevilClaw Overview](/docs/DevilClaw/overview)
- [Dashboard Reference](/docs/DevilClaw/dashboard)
- [GitHub Integration](/docs/DevilClaw/development-tools/github)
- [Pre-installed Software](/docs/DevilClaw/pre-installed-software)
- [Chat Platforms](/docs/DevilClaw/chat-platforms)
