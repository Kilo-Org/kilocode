package ai.kilocode.client.actions

import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.ide.BrowserUtil
import java.net.URLEncoder

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

internal fun openHostedWorkspaceInBrowser(dto: HostedWorkspaceDto, organizationID: String?, surface: String) {
    val session = dto.sessions.maxByOrNull { it.updated }?.nativeSessionID
    Telemetry.send("Cloud Open In Browser Clicked", mapOf("surface" to surface))
    BrowserUtil.browse(hostedWorkspaceBrowserUrl(dto.ref, organizationID, session))
}
