package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.worktree.isDefaultSessionTitle

internal object HostedWorkspaceTitle {
    fun text(name: String?, branch: String?, workspace: String, session: String? = null): String =
        session?.takeIf { it.isNotBlank() && !isDefaultSessionTitle(it) }
            ?: name?.takeIf { it.isNotBlank() }
            ?: branch?.takeIf { it.isNotBlank() }
            ?: workspace
}
