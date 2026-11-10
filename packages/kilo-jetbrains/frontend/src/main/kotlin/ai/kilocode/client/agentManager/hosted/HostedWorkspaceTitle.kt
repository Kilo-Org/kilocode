package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.worktree.isDefaultSessionTitle
import ai.kilocode.rpc.dto.HostedWorkspaceDto

internal object HostedWorkspaceTitle {
    // Cloud names a workspace after its generated worktree branch when the user did not name it.
    private val GENERATED = Regex(
        "^worktree_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{8,12}$",
    )

    fun text(name: String?, branch: String?, workspace: String, session: String? = null): String =
        session?.takeIf { it.isNotBlank() && !isDefaultSessionTitle(it) }
            ?: name?.takeIf { it.isNotBlank() && !GENERATED.matches(it) }
            ?: branch?.takeIf { it.isNotBlank() }
            ?: workspace

    /** One title for the tree row, editor tab, header, and status bar. */
    fun text(dto: HostedWorkspaceDto): String =
        text(dto.name, dto.branch, dto.ref.workspaceID, dto.sessions.maxByOrNull { it.updated }?.title)
}