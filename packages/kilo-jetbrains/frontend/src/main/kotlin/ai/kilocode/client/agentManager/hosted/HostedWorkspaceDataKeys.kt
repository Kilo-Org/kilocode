package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedWorkspaceDto
import com.intellij.openapi.actionSystem.DataKey

object HostedWorkspaceDataKeys {
    val WORKSPACE: DataKey<HostedWorkspaceDto> = DataKey.create("ai.kilocode.client.agentManager.hosted.Workspace")
}
