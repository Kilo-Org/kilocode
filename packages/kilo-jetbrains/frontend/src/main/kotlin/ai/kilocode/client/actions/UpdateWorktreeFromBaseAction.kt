package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerCommand

/** Asks the selected worktree's agent to fetch and merge its saved base branch. */
class UpdateWorktreeFromBaseAction : AgentManagerAction(AgentManagerCommand.UPDATE_BASE)
