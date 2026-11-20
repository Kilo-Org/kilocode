package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerCommand

/** Copies a human-readable pull request reference (`<title> - <url>`) for the selected worktree. */
class CopyWorktreePrRefAction : AgentManagerAction(AgentManagerCommand.COPY_PR)
