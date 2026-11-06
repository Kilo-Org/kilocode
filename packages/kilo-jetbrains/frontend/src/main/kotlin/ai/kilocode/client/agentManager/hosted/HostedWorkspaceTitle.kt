package ai.kilocode.client.agentManager.hosted

internal object HostedWorkspaceTitle {
    fun text(name: String?, branch: String?, workspace: String): String =
        name?.takeIf { it.isNotBlank() }
            ?: branch?.takeIf { it.isNotBlank() }
            ?: workspace
}
