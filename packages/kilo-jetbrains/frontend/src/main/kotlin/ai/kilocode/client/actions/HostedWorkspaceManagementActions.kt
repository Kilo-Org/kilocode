package ai.kilocode.client.actions

import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.project.DumbAware
import java.net.URLEncoder

abstract class HostedWorkspaceAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT
}

internal fun hostedWorkspaceBrowserUrl(
    ref: HostedWorkspaceRefDto,
    organizationID: String? = null,
    sessionID: String? = null,
): String {
    val base = organizationID?.takeIf { it.isNotBlank() }?.let {
        "https://app.kilocode.ai/organizations/${URLEncoder.encode(it, Charsets.UTF_8)}/cloud/chat"
    } ?: "https://app.kilocode.ai/cloud/chat"
    val query = buildList {
        add("worktreeId=${URLEncoder.encode(ref.workspaceID, Charsets.UTF_8)}")
        sessionID?.takeIf { it.isNotBlank() }?.let {
            add("sessionId=${URLEncoder.encode(it, Charsets.UTF_8)}")
        }
    }.joinToString("&")
    return "$base?$query"
}
