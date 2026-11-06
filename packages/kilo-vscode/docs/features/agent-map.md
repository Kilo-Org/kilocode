# Agent Map

A session can start agents in three ways: Task subagents (foreground or background, nested when `subagent_depth` allows), Agent Manager sessions through the `agent_manager` tool, and background processes through the `background_process` tool. The background agent stack (see [background-agent-visibility.md](background-agent-visibility.md)) lists only the agents the current session started. Nothing showed the whole family or who started whom.

The agent map is a dialog that draws a tree rooted at the current session: the session on the left, each generation it started in a column to its right, background processes under the session that runs them. Opened from a subagent, the map starts at that subagent. Agents above it did not come from it, so they stay out.

## Entry points

- The task header shows a map button when the current session has a call that started something: a `task` call, an `agent_manager` start, or a `background_process` start or monitor (`starter()` in `background-agents.ts`). Other `agent_manager` and `background_process` actions only act on what exists, so they do not count.
- The session dock shows the agent map button (`AgentStack.tsx`) in place of the former avatar stack and board button. It shows how many background agents of the current run still work, marks agents that wait for the user and unread board posts, and opens the map on click. It is there while the run has background agents or the board has posts. Stop all moved from the stack's panel into the map; Hide finished replaces Clear finished.

## Board tab

When the session has a shared agent board, the dialog shows Map and Board tabs. The Board tab is the only board reader: it replaced the dock's board popover and the full board dialog. `ChatView` provides one board state (`SwarmBoardProvider`) to the session dock and the dialog, so reading posts in the tab clears the dock button's unread mark. A dock outside a chat view, such as in a story, keeps its own board and passes it to the dialog.

- Refresh reloads the newest posts. Reset board asks in place inside the tab, so the dialog stays open, and is disabled after a failed load or reset until a refresh succeeds, because the board revision may be stale.
- A node's details link to its posts: the Board tab filters to posts the agent sent or received. The board names its owner session `main`.
- A sender in a post selects its node on the map when the map has it, and otherwise opens the agent's transcript.
- The dialog closes when the chat switches to another session, so it never shows another session's agents or posts.

## Avatars

Agent nodes carry the `AgentAvatar` of their session ID, the same glyph and color the task cards show, under the chat view's `AgentAvatarPalette`. Running agents animate. Processes show a terminal icon instead.

## Hide finished

A switch hides finished nodes. A node that still runs keeps the chain that started it, finished or not, so the tree stays connected. The root always shows. The choice is kept in the webview state.

## Edges

| Edge | Where it is recorded |
|---|---|
| Task subagent | The child session's `parentID`. |
| Agent Manager session | The `kilo.agentManager.source` session metadata key. `tool-start.ts` writes it when it creates the session, through `stamp()` in `prompt-attribution.ts`, together with `kilo.agentManager.request`, the request ID of the `agent_manager` call. |
| Background process | The process's `sessionID`. |

Agent Manager sessions are root sessions in sibling worktrees, so `parentID` cannot carry the edge: a parent ID would make them child sessions, which Agent Manager deliberately keeps out of its tabs. Sessions created before the metadata key existed have no edge and do not appear.

## Data flow

The webview cannot build the map itself: it holds only the sessions it opened, and a nested subagent or a session in another worktree is rarely one of them. So the extension walks the backend in [agent-map.ts](../../src/kilo-provider/agent-map.ts):

1. Read the requested session. It is the root.
2. Walk down level by level: `session.children` for Task subagents, and the worktree family session list (`experimental.session.list` with `worktrees`, filtered to sessions updated since the root started) for Agent Manager sessions.
3. Per directory in the tree: session status, pending permissions and questions, and background processes. Per parent: background jobs, which tell how a background agent ended.
4. Read the transcript of each session that started something that has stopped, to leave out what reverted turns started (see Reverts).
5. `build()` lays out the nodes. It is pure. `tests/unit/agent-map.test.ts` covers it, and covers `load()` against a fake client.

The dialog polls every two seconds while the map shows. Each poll walks the whole family, so it waits while the webview is inactive (`vscode.active()`, the same gate the board uses) or the Board tab is open, and polls once as soon as the map shows again. The map stops at 200 nodes and marks itself truncated.

The provider keeps the directory of every node in the maps it loaded, up to 2,000 entries. A map refreshes the entries it sees, and the oldest go first. It does not keep only the latest map, because a transcript opened from an earlier map may still need its directory. For a session it has no directory of its own for, `getWorkspaceDirectory` falls back to that one, so Stop and the sub-agent viewer reach the backend instance that runs the session, including Agent Manager sessions in other worktrees. The map does not add them to `sessionDirectories`, which also decides which directories session history lists.

## Reverts

A revert hides the messages of the turns it undoes, and the next message deletes them. The backend keeps the child sessions, Agent Manager sessions, and background processes those turns started, with their edges intact, so the edges alone would keep them on the map.

So the map reads the transcript of each session that started something and collects what its remaining starting calls recorded: `sessionId` for `task`, `requestID` for an `agent_manager` start, `processID` for a `background_process` start or monitor. `background_process` records `processID` on its other actions too, so those do not count. Parts past the session's `revert` boundary do not count, the same way the chat hides them. A node whose starting call is gone leaves the map with its subtree, unless it or anything under it still runs or waits, so it can still be stopped. For the same reason, only the owners of nodes that have stopped are read.

Agent Manager sessions without `kilo.agentManager.request` cannot be traced and always stay. A process with the `parent` lifetime stays while the subagent that started it runs. When that subagent finishes, it hands the process to its parent, so the map also looks for the starting call in the transcripts of the parent's subagents that existed when the process started. A transcript that fails to load leaves its nodes in place.

The dialog polls, so `load()` keeps the last read of each transcript and reads it again only when it can have changed what the map needs: the session's `time.updated` or `revert` changed, it started or stopped running, or it owns something the last read did not look for. A call can record what it started only when it ends, after a quick process has already stopped, so while the session runs, a read that lacks something it owns is trusted for 10 seconds. The cache keeps only the sessions the latest map needed.

The webview follows the same rule with the session's tool parts and `revert` (`shown()` and `reverted()` in `background-agents.ts`): the task header button ignores starting calls past the revert boundary, and the dock button drops finished agents that only reverted turns started. `shown()` compares IDs rather than positions, because the session's tool index does not hold the text part a revert can stop at. IDs sort in the order they were created.

Board posts do not follow reverts. They are stored apart from the transcript and stay until the board is reset.

## Actions

- **Open transcript** uses `openSubagent`, so Agent Manager opens the inspector and other surfaces open an editor tab. The chat's current session is passed as the parent, because Agent Manager only opens agents under a session it manages. The dialog stays open, except for the root, whose transcript is the chat behind it.
- **Stop agent** sends `abort` with `scope: "tree"`, like the background agent stack.
- **Stop all** stops each running agent that no running agent above it stops already (`stoppable()` in `agent-map.ts`), because a tree abort reaches every subagent below. Agent Manager sessions are roots of their own, so they are stopped one by one.
- **Stop process** sends `stopBackgroundProcess`, which stops the process through the instance of its owning session.
- Read-only surfaces hide the stop actions.

## Known limits

- Status for foreground Task agents that ended with an error reads as done. Only background jobs record how an agent ended.
- The prompt shows only when the parent session's tool parts are loaded in the webview.
- The map polls instead of following session events.
- Board posts from reverted turns stay on the board.
