package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerCommand

/** Copies the git branch checked out in the selected worktree. */
class CopyBranchNameAction : AgentManagerAction(AgentManagerCommand.COPY_BRANCH)
