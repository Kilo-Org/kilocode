package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerCommand

/** Copies the absolute path of the worktree the branch is checked out in. */
class CopyBranchPathAction : AgentManagerAction(AgentManagerCommand.COPY_PATH)
