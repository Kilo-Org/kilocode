---
title: "Session History and Search"
description: "Find, search, inspect, and resume local Kilo Code sessions"
---

# Session history and search

Kilo Code keeps local session metadata and transcripts so you can resume earlier work. You can search session titles in the history UI or CLI, ask the agent to search transcript content, or inspect the local SQLite database directly.

{% callout type="info" %}
Local sessions use SQLite, not PostgreSQL. Use `kilo db` or `sqlite3`, not `psql`, to inspect the local database.
{% /callout %}

## Choose a search method

Different search surfaces cover different content and scopes:

| Method | Searches | Scope |
|---|---|---|
| VS Code or JetBrains History | Session titles | Sessions loaded in the selected Local or Cloud history view |
| CLI `/sessions` picker | Session titles | Current workspace |
| `kilo session list --search` | Session titles | Current workspace, or every local workspace with `--all` |
| Ask Kilo to recall past chats | Titles and high-signal transcript content | Current workspace |
| VS Code transcript search | Rendered content in the open session | Current session |
| SQLite query | Any stored field you select | Entire selected local database |

History and CLI list searches do **not** search message content. To find a string inside prompts or replies, ask Kilo to search past chats or use a direct SQLite query.

## Search in the UI

{% tabs %}
{% tab label="VS Code" %}

### Search session history

1. Open the Kilo Code sidebar.
2. Select the **History** button in the sidebar title bar. You can also select **Show History** below the recent sessions on a new chat.
3. Select **Local** or **Cloud**.
4. Enter part of a session title in **Search sessions**.
5. Select a result to reopen it.

Local history actions also let you rename, export, or delete a session. Cloud history can be filtered to **Only this repository**.

The History search is a fuzzy title search over the sessions currently loaded into the view. It does not search prompts or agent replies.

### Search the open transcript

Open a session and select the magnifying-glass button in its header. Transcript search supports:

- Previous and next match navigation
- Match case
- Whole word
- Regular expressions

Kilo loads older messages while the search is active so the search covers the full local transcript, not only the messages initially visible.

### Reference another session

Type `@` in the chat input, select **Past chats**, and search by session title or workspace name. Selecting a result attaches that transcript as context when you send the message. Past chats includes sessions in the current workspace.

{% /tab %}
{% tab label="JetBrains" %}

1. Open the Kilo Code tool window.
2. Select **History** in the tool window toolbar.
3. Select **Local** or **Cloud**.
4. Enter part of a session title in **Search sessions**.
5. Select a result to reopen it.

You can rename or delete local sessions. In Cloud history, enable **Only this repository** to narrow the list.

The JetBrains History search matches session titles, not transcript content.

{% /tab %}
{% tab label="CLI TUI" %}

Run `kilo`, then enter any of these commands:

```text
/sessions
/resume
/continue
```

Start typing in the session picker to filter sessions by title. The picker also supports reopening, pinning, and deleting local sessions.

{% /tab %}
{% /tabs %}

## Ask Kilo to search transcripts

The simplest way to search message content across past local sessions is to ask Kilo directly:

```text
Search my local sessions for "database disk image is malformed" and summarize the matching conversations.
```

Kilo's local recall search covers session titles, user and assistant text, file references, and failed tool errors in the current workspace. Every query term must occur somewhere in a matching session; exact phrases and user-authored matches rank higher.

The search includes archived and child sessions. It excludes reasoning, synthetic or ignored text, successful tool output, file contents, and other metadata. Kilo can then read the full transcript for a selected result.

## Search with CLI commands

### Filter session titles

List sessions in the current workspace:

```bash
kilo session list --search "database migration"
```

Search titles across every local workspace and return JSON:

```bash
kilo session list --all --search "database migration" --format json
```

Limit the number of results:

```bash
kilo session list --all --search "migration" --max-count 25
```

`--search` performs a SQLite `LIKE` substring search on the title. It does not inspect messages. Use the returned session ID to resume or export a session:

```bash
kilo --session ses_123
kilo run --session ses_123 "Summarize where we stopped"
kilo export ses_123 > session.json
```

### Find the local database

Print the database selected by the current CLI environment:

```bash
kilo db path
```

Stable installations normally use these paths:

| Environment | Default path |
|---|---|
| Windows | `%LOCALAPPDATA%\kilo\kilo.db` |
| macOS | `~/Library/Application Support/kilo/kilo.db` |
| Linux | `~/.local/share/kilo/kilo.db` |
| VS Code Remote SSH | `~/.local/share/kilo/kilo.db` on the remote machine |

The actual path can differ when `KILO_DB`, `XDG_DATA_HOME`, a development channel, or an isolated development environment is active. Prefer `kilo db path` over assuming a path.

## Query SQLite directly

{% callout type="warning" %}
The `kilo db` query command accepts arbitrary SQL, including writes. Use read-only queries, and use `sqlite3 -readonly` for safer interactive inspection. Stop Kilo before copying, replacing, or restoring the database because active transactions may also use `kilo.db-wal` and `kilo.db-shm`.
{% /callout %}

### Use the built-in database command

List recently updated sessions:

```bash
kilo db "
  SELECT
    id,
    title,
    directory,
    datetime(time_updated / 1000, 'unixepoch') AS updated
  FROM session
  ORDER BY time_updated DESC
  LIMIT 25
" --format json
```

Search non-synthetic text parts for a case-insensitive substring:

```bash
kilo db "
  SELECT
    s.id AS session_id,
    s.title,
    json_extract(m.data, '$.role') AS role,
    json_extract(p.data, '$.text') AS text
  FROM session AS s
  JOIN message AS m ON m.session_id = s.id
  JOIN part AS p ON p.message_id = m.id
  WHERE json_valid(p.data)
    AND json_extract(p.data, '$.type') = 'text'
    AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
    AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0
    AND instr(
      lower(json_extract(p.data, '$.text')),
      lower('database disk image is malformed')
    ) > 0
  ORDER BY s.time_updated DESC, m.time_created, p.id
" --format json
```

Replace the search string in the second `lower(...)` expression. This query searches ordinary user and assistant text. It intentionally does not reproduce Kilo's recall ranking, workspace scope, file-reference matching, or tool-error matching.

### Use the SQLite shell

Install the `sqlite3` command-line tool, then open the selected database in read-only mode:

```bash
sqlite3 -readonly "$(kilo db path)"
```

Useful commands inside the shell include:

```sql
.tables
.schema session
.schema message
.schema part
```

Run the SQL examples above without the surrounding `kilo db` command. Exit with `.quit`.

`psql` cannot open this file because `psql` speaks the PostgreSQL client protocol, while local Kilo sessions are stored in an embedded SQLite database.

## Search through the API or SDK

Run a local server with authentication before exposing its API:

```bash
export KILO_SERVER_PASSWORD='replace-with-a-strong-password'
kilo serve --port 4096
```

Search session titles in the current directory:

```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" \
  --get "http://127.0.0.1:4096/session" \
  --data-urlencode "directory=$PWD" \
  --data-urlencode "roots=true" \
  --data-urlencode "search=migration" \
  --data-urlencode "limit=50"
```

Read the complete transcript for one result:

```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" \
  --get "http://127.0.0.1:4096/session/ses_123/message" \
  --data-urlencode "directory=$PWD"
```

The list endpoint's `search` parameter searches titles only. To search transcript text programmatically, list candidate sessions, read their messages, and inspect text parts in your application.

The JavaScript SDK exposes the same endpoints:

```ts
import { createKiloClient } from "@kilocode/sdk/v2/client"

const auth = Buffer.from(`kilo:${process.env.KILO_SERVER_PASSWORD}`).toString("base64")
const client = createKiloClient({
  baseUrl: "http://127.0.0.1:4096",
  directory: process.cwd(),
  headers: { Authorization: `Basic ${auth}` },
})

const result = await client.session.list(
  { roots: true, search: "migration", limit: 50 },
  { throwOnError: true },
)

for (const session of result.data) {
  const transcript = await client.session.messages(
    { sessionID: session.id, limit: 0 },
    { throwOnError: true },
  )

  // Inspect transcript.data[*].parts for the content your application needs.
  console.log(session.title, transcript.data.length)
}
```

`limit: 0` requests the complete transcript from the compatibility API. For large sessions, use a positive `limit` and follow the pagination cursor instead.

## Local and cloud sessions

Local sessions live in the SQLite database on the machine where Kilo runs. With VS Code Remote SSH, that means the remote host. Cloud sessions and shared-session copies are separate and are not available through local SQLite queries unless you import them locally.

For database corruption or reset procedures, see [Troubleshooting IDE Extensions](/docs/getting-started/troubleshooting/troubleshooting-extension). Resetting the database removes local session history, so back it up before recovery work.
