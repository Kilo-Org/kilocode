package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.vfs.KiloEditorKind
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.Icon
import javax.swing.JComponent

/**
 * Editor identity for one Cloud workspace: its provider and workspace ids, never a local path.
 * Sessions inside it are selected through hosted [SessionRef] keys.
 */
object HostedWorkspaceEditorKind : KiloEditorKind {
    const val ID = "hosted-workspace"
    const val PROVIDER = "provider"
    const val WORKSPACE = "workspace"

    override val id: String = ID

    override fun title(params: Map<String, String>): String {
        val ref = HostedWorkspaceRefDto(params[PROVIDER].orEmpty(), params[WORKSPACE].orEmpty())
        val dto = service<HostedWorkspaceCache>().get(ref)
        return HostedWorkspaceTitle.text(dto?.name, dto?.branch, params[WORKSPACE].orEmpty())
    }

    override fun icon(params: Map<String, String>): Icon = HostedWorkspaceIcons.cloud
    override fun fileType(params: Map<String, String>): FileType = HostedWorkspaceFileType
    override fun presentablePath(params: Map<String, String>): String = title(params)
    override fun isValid(params: Map<String, String>): Boolean =
        !params[PROVIDER].isNullOrBlank() && !params[WORKSPACE].isNullOrBlank()

    @RequiresEdt
    override fun preferredFocus(component: JComponent): JComponent? =
        (component as? HostedWorkspaceEditorPanel)?.preferredFocus()

    @RequiresEdt
    override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent {
        val provider = file.path.params[PROVIDER]?.takeIf { it.isNotBlank() } ?: return BorderLayoutPanel()
        val workspace = file.path.params[WORKSPACE]?.takeIf { it.isNotBlank() } ?: return BorderLayoutPanel()
        val ref = HostedWorkspaceRefDto(provider, workspace)
        val dto = service<HostedWorkspaceCache>().get(ref)
        return HostedWorkspaceEditorPanel(
            parent = parent,
            project = project,
            ref = ref,
            name = dto?.name,
            branch = dto?.branch,
        )
    }
}

object HostedWorkspaceFileType : FileType {
    override fun getName(): String = "KILO_HOSTED_WORKSPACE"
    override fun getDisplayName(): String = "Kilo Cloud workspace"
    override fun getDescription(): String = "A Cloud workspace served through the local Session Host"
    override fun getDefaultExtension(): String = "kilo-cloud-workspace"
    override fun getIcon(): Icon = HostedWorkspaceIcons.cloud
    override fun isBinary(): Boolean = true
    override fun isReadOnly(): Boolean = true
    override fun getCharset(file: VirtualFile, content: ByteArray): String? = null
}

object HostedWorkspaceEditorMatcher : WorktreeEditorMatcher {
    override fun match(file: VirtualFile): String? {
        val kilo = file as? KiloVirtualFile ?: return null
        if (kilo.path.kind != HostedWorkspaceEditorKind.ID) return null
        val provider = kilo.path.params[HostedWorkspaceEditorKind.PROVIDER] ?: return null
        val workspace = kilo.path.params[HostedWorkspaceEditorKind.WORKSPACE] ?: return null
        return HostedIDs.workspace(provider, workspace)
    }
}

fun ensureHostedWorkspaceEditorKind() {
    service<KiloEditorKindRegistry>().register(HostedWorkspaceEditorKind)
}

internal fun hostedWorkspaceParams(dto: HostedWorkspaceDto): Map<String, String> =
    buildMap {
        put(HostedWorkspaceEditorKind.PROVIDER, dto.ref.providerID)
        put(HostedWorkspaceEditorKind.WORKSPACE, dto.ref.workspaceID)
    }

internal fun openHostedWorkspace(project: Project, dto: HostedWorkspaceDto, focus: Boolean = true) {
    ensureHostedWorkspaceEditorKind()
    service<HostedWorkspaceCache>().put(dto)
    project.service<WorktreeEditorMatchers>().register(HostedWorkspaceEditorMatcher)
    project.service<KiloVfsManager>().open(HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto), focus)
}

internal fun hostedWorkspaceRoot(project: Project): ai.kilocode.client.app.Workspace =
    project.service<KiloWorkspaceService>().workspace(project.basePath.orEmpty())
