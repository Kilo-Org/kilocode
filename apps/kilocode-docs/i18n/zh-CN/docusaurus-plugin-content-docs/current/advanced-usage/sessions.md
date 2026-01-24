# Sessions

A session is your platform-agnostic interaction with Kilo. It remembers your repository, your task, and the conversation so you can pause and resume work without losing context. Sessions are private to your account by default; you can optionally share a link with others who can read or fork your session.

## What a session keeps for you

- Repository you chose to work on
- The conversation with the agent (your prompts and the agent’s replies)
- Task metadata (what the agent is doing for you)
- Optional Git context (for example, the repo URL and a lightweight snapshot of state) so the agent can pick up where it left off

This information lets Kilo show your recent sessions and continue right from the same context the next time you open it.

## Quick start: Create a session

1. Choose the repository. Pick the GitHub repository you want the agent to work with.
2. Describe the task. (e.g., “Add dark mode toggle and unit tests”).
3. Interact with Kilo via any of our interfaces- the CLI, the Cloud Agent, or the Extensions in your favorite IDE.

## Continue where you left off

1. Open Cloud Agents → Recent Sessions and select the session you want to resume.
2. The chat will load with your previous messages and context so the agent can keep going without re-explaining your task.

## Share a session (read‑only)

You can share a session with anyone via a link. A shared page:

1. Shows who shared it, the session title, and a short preview of the conversation
2. Provides safe “open in editor” or CLI actions so collaborators can try your session themselves
3. Lives at a URL like /share/SHARE_ID and is visible to anyone with the link

Note: Sharing creates a read‑only copy for the public link so your private session remains in your account.

## Fork a shared session (make it yours)

If someone shares a session with you, you can fork it to create your own copy:

- From the share page, choose “Open in Editor” (recommended), or run one of these commands:
    - CLI: kilocode --fork SHARE_ID
    - In‑app command: /session fork SHARE_ID

Forking creates a new session in your account, with its own ID, and copies over the relevant context so you can continue independently.

## Where your session data lives

To keep sessions fast and resumable, Kilo stores small JSON blobs associated with your session. These include your conversation history and task metadata. If you share a session, Kilo keeps a public copy used by the share link while your private session remains under your account.

Good practice:

1. Don’t paste secrets into prompts. Use environment variables when needed.
2. If a share link is created, treat it like any other public link—anyone with it can view the shared copy.

## Power‑user tips

1. Keep your task description focused; you can refine it with follow‑up prompts.
2. Use setup commands to prepare the environment the agent runs in (e.g., install dependencies).
3. For collaboration, share and ask teammates to fork; you’ll each have independent progress and costs.
