package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.active.ActiveDeleteOptions
import ai.kilocode.client.ui.active.showActiveDeletePopup
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.ui.awt.RelativePoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Cloud workspace deletion shared by the list row and the workspace editor. The row keeps its
 * place with the same trailing progress text and spinner as a local worktree delete, then
 * disappears after Cloud confirms.
 */
@Service(Service.Level.PROJECT)
class HostedWorkspaceRemoval internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    private val _deleting = MutableStateFlow<Set<String>>(emptySet())
    val deleting: StateFlow<Set<String>> = _deleting.asStateFlow()
    private val _removed = MutableSharedFlow<HostedWorkspaceRefDto>(extraBufferCapacity = 16)
    val removed: SharedFlow<HostedWorkspaceRefDto> = _removed.asSharedFlow()

    fun isDeleting(ref: HostedWorkspaceRefDto): Boolean = ref.key in _deleting.value

    fun confirm(anchor: RelativePoint, ref: HostedWorkspaceRefDto, directory: String) {
        val opts = ActiveDeleteOptions(
            message = KiloBundle.message("hosted.workspace.delete.message"),
            detail = KiloBundle.message("hosted.workspace.delete.detail"),
        )
        showActiveDeletePopup(anchor, opts) { delete(ref, directory) }
    }

    fun delete(ref: HostedWorkspaceRefDto, directory: String) {
        if (ref.key in _deleting.value) return
        _deleting.update { it + ref.key }
        cs.launch {
            val result = project.service<KiloHostedService>().delete(ref)
            withContext(Dispatchers.Main) {
                _deleting.update { it - ref.key }
                val hosted = project.service<KiloHostedService>()
                if (!result.success) {
                    KiloNotifications.error(
                        project,
                        KiloBundle.message("hosted.workspace.delete.failed"),
                        result.failure?.message,
                        KiloBundle.message("common.retry"),
                    ) { delete(ref, directory) }
                    hosted.refresh(directory)
                    return@withContext
                }
                project.service<HostedManagementService>().forget(ref)
                service<HostedWorkspaceCache>().remove(ref)
                project.service<KiloVfsManager>().close(
                    HostedWorkspaceEditorKind.ID,
                    hostedWorkspaceParams(HostedWorkspaceDto(ref)),
                )
                _removed.tryEmit(ref)
                hosted.refresh(directory)
            }
        }
    }
}
