package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.agentManager.hosted.openHostedWorkspace
import ai.kilocode.client.agentManager.hosted.hostedWorkspaceParams
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.KiloTelemetryService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.w3c.dom.Element

@Suppress("UnstableApiUsage")
class ReloadHostedWorkspaceActionTest : BasePlatformTestCase() {
    companion object {
        private const val ID = "Kilo.HostedWorkspace.Reload"
    }

    private val ref = HostedWorkspaceRefDto("cloud", "workspace")
    private val dto = HostedWorkspaceDto(ref, sessions = emptyList())
    private val action = ReloadHostedWorkspaceAction()
    private lateinit var scope: CoroutineScope
    private lateinit var hosted: KiloHostedService
    private lateinit var rpc: FakeRpc
    private lateinit var coroutines: TestCoroutines
    private var enabled = true

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeRpc(dto)
        hosted = KiloHostedService(scope, rpc, gate = { enabled }, log = TestLog())
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        ApplicationManager.getApplication().replaceService(
            KiloTelemetryService::class.java,
            KiloTelemetryService(scope, FakeAppRpcApi()),
            testRootDisposable,
        )
        service<KiloEditorKindRegistry>().register(HostedWorkspaceEditorKind)
    }

    override fun tearDown() {
        try {
            service<KiloEditorKindRegistry>().unregister(HostedWorkspaceEditorKind.ID)
            KiloVirtualFileSystem.getInstance().clear()
            coroutines.close()
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test reload hides and does nothing without a project or Cloud workspace`() {
        listOf(event(project = false), event(workspace = null)).forEach {
            update(it)
            action.actionPerformed(it)
            assertFalse(it.presentation.isVisible)
            assertFalse(it.presentation.isEnabled)
        }
    }

    fun `test reload is scoped to a persisted active Cloud workspace`() {
        val event = event()
        update(event)
        assertTrue(event.presentation.isEnabledAndVisible)
        assertEquals(ActionUpdateThread.EDT, action.actionUpdateThread)

        val deleted = event(workspace = dto.copy(deletionState = "deleted"))
        update(deleted)
        assertFalse(deleted.presentation.isVisible)
        val pending = event(workspace = dto.copy(ref = HostedWorkspaceRefDto("cloud", "pending-create")))
        update(pending)
        assertFalse(pending.presentation.isVisible)
        enabled = false
        val disabled = event()
        update(disabled)
        assertFalse(disabled.presentation.isVisible)
    }

    fun `test reload closes the editor before reconnecting and opens one replacement`() {
        edt { openHostedWorkspace(project, dto) }
        val manager = FileEditorManager.getInstance(project)
        assertEquals(1, manager.openFiles.size)

        val event = event()
        edt { action.actionPerformed(event) }

        assertTrue(coroutines.pumpUntil { edtWait { manager.openFiles.size == 1 } })
        assertEquals(1, manager.openFiles.size)
        assertNotNull(KiloVirtualFileSystem.getInstance().cached(
            ai.kilocode.client.vfs.KiloPath(HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto)),
        ))
    }

    fun `test reload replaces refresh in the existing row menu with localized strings`() {
        val descriptor = PluginDescriptor.frontend()
        val declared = descriptor.elements("action").single { it.attribute("id") == ID }

        assertEquals(ReloadHostedWorkspaceAction::class.java.name, declared.attribute("class"))
        assertFalse(descriptor.elements("action").any { it.attribute("id") == "Kilo.HostedWorkspace.Refresh" })
        assertTrue(descriptor.elements("reference").any {
            it.attribute("ref") == ID && (it.parentNode as? Element)?.attribute("id") == "Kilo.Worktree.RowMenu"
        })
        assertEquals("Reload", KiloBundle.optional("action.$ID.text"))
        assertFalse(KiloBundle.optional("action.$ID.description").isNullOrBlank())
    }

    private fun event(workspace: HostedWorkspaceDto? = dto, project: Boolean = true): AnActionEvent {
        val context = DataContext { id ->
            when {
                CommonDataKeys.PROJECT.`is`(id) -> this.project.takeIf { project }
                HostedWorkspaceDataKeys.WORKSPACE.`is`(id) -> workspace
                else -> null
            }
        }
        return AnActionEvent.createFromDataContext(ActionPlaces.POPUP, Presentation(), context)
    }

    private fun update(event: AnActionEvent) = ActionUtil.updateAction(action, event)

    private fun edt(block: () -> Unit) = ApplicationManager.getApplication().invokeAndWait(block)

    private class FakeRpc(private val dto: HostedWorkspaceDto) : KiloHostedRpcApi {
        override suspend fun providers(): List<HostedProviderDto> = emptyList()
        override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
            HostedWorkspaceListDto(items = listOf(dto))
        override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto {
            return dto
        }
        override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedWorkspaceStatusDto(ref, "active", "running", "ready", 1.0)
        override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> =
            flow { kotlinx.coroutines.awaitCancellation() }
        override suspend fun workspaceProfiles(organizationID: String?) = ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
        override suspend fun setPersonalDefaultProfile(profileID: String) = ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
        override suspend fun createWorkspace(request: ai.kilocode.rpc.dto.HostedCreateWorkspaceDto) = ai.kilocode.rpc.dto.HostedMutationResultDto()
        override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
            ai.kilocode.rpc.dto.HostedMutationResultDto()
        override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
            ai.kilocode.rpc.dto.HostedDeleteResultDto(ref)
    }
}
