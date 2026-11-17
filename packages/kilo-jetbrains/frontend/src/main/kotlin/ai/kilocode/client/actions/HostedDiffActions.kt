package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedPullRequestService
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.diff.HostedDiffComparison
import ai.kilocode.client.diff.openHostedDiff
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.util.concurrency.annotations.RequiresEdt

abstract class HostedDiffAction : HostedWorkspaceAction() {
    internal abstract val comparison: HostedDiffComparison

    @RequiresEdt
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = workspace(e) != null
    }

    @RequiresEdt
    override fun actionPerformed(e: AnActionEvent) {
        val item = workspace(e) ?: return
        val project = e.project ?: return
        Telemetry.send("Cloud Diff Opened", mapOf("comparison" to comparison.name.lowercase()))
        openHostedDiff(project, item.ref, comparison)
    }

    @RequiresEdt
    private fun workspace(e: AnActionEvent): HostedWorkspaceDto? {
        val project = e.project ?: return null
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return null
        val hosted = project.service<KiloHostedService>()
        if (!hosted.enabled() || hosted.state.value.signedOut) return null
        if (item.ref.workspaceID.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX)) return null
        if (item.deletionState == "deleted" || item.deletionState == "deleting") return null
        if (comparison == HostedDiffComparison.PULL_REQUEST &&
            project.service<HostedPullRequestService>().pulls.value[item.ref.key] == null
        ) return null
        return item
    }
}

class HostedCommittedDiffAction : HostedDiffAction() {
    override val comparison = HostedDiffComparison.COMMITTED
}

class HostedUncommittedDiffAction : HostedDiffAction() {
    override val comparison = HostedDiffComparison.UNCOMMITTED
}

class HostedPullRequestDiffAction : HostedDiffAction() {
    override val comparison = HostedDiffComparison.PULL_REQUEST
}
