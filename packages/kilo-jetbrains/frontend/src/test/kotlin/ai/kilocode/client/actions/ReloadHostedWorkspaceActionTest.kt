package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerAvailability
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerFacade
import ai.kilocode.client.agentManager.AgentManagerKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.agentManager.hosted.HostedPullRequestService
import ai.kilocode.client.agentManager.hosted.openHostedWorkspace
import ai.kilocode.client.agentManager.hosted.hostedWorkspaceParams
import ai.kilocode.client.agentManager.hosted.reloadHostedWorkspace
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.KiloTelemetryService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeAgentManagerFacade
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.util.Disposer
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
    private val element = AgentManagerElement.Cloud(dto)
    private val facade = FakeAgentManagerFacade().apply { enabled = setOf(AgentManagerCommand.RELOAD) }
    private val action = ReloadHostedWorkspaceAction()
    private lateinit var scope: CoroutineScope
    private lateinit var coroutines: TestCoroutines

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val hosted = KiloHostedService(scope, FakeRpc(dto), gate = { true }, log = TestLog())
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(
            HostedPullRequestService::class.java,
            HostedPullRequestService(
                scope,
                read = { HostedWorkspacePullRequestDto(it, "unavailable", null) },
                revalidate = { HostedWorkspacePullRequestDto(it, "unavailable", null) },
                pause = {},
                clock = { 0L },
                identity = null,
                signedOut = null,
            ),
            testRootDisposable,
        )
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

    fun `test reload hides and does nothing without a facade or element`() {
        listOf(event(facade = null), event(element = null)).forEach {
            update(it)
            edtWait { action.actionPerformed(it) }
            assertFalse(it.presentation.isVisible)
            assertFalse(it.presentation.isEnabled)
        }
        assertTrue(facade.queries.isEmpty())
        assertTrue(facade.calls.isEmpty())
    }

    fun `test reload delegates availability and rechecks stale clicks through the facade`() {
        val event = event()
        update(event)
        assertTrue(event.presentation.isEnabledAndVisible)
        assertEquals(ActionUpdateThread.EDT, action.actionUpdateThread)
        assertSame(element, facade.queries.single().first)
        assertEquals(AgentManagerCommand.RELOAD, facade.queries.single().second)

        facade.overrides[AgentManagerCommand.RELOAD] = AgentManagerAvailability.DISABLED
        edtWait { action.actionPerformed(event) }
        assertEquals(2, facade.queries.size)
        assertTrue(facade.calls.isEmpty())
        update(event)
        assertTrue(event.presentation.isVisible)
        assertFalse(event.presentation.isEnabled)

        facade.overrides[AgentManagerCommand.RELOAD] = AgentManagerAvailability.HIDDEN
        update(event)
        assertFalse(event.presentation.isVisible)
        edtWait { action.actionPerformed(event) }
        assertTrue(facade.calls.isEmpty())

        facade.overrides[AgentManagerCommand.RELOAD] = AgentManagerAvailability.ENABLED
        edtWait { action.actionPerformed(event) }
        assertSame(element, facade.calls.single().element)
        assertEquals(AgentManagerCommand.RELOAD, facade.calls.single().command)
    }

    fun `test reload rebuilds inside the selected editor without changing selection`() {
        edtWait { openHostedWorkspace(project, dto) }
        val manager = FileEditorManager.getInstance(project)
        assertEquals(1, manager.openFiles.size)
        val file = manager.selectedFiles.single()
        val container = manager.getSelectedEditor(file)!!.component
        val old = container.components.single()

        edtWait { reloadHostedWorkspace(project, dto) }

        assertSame(file, manager.selectedFiles.single())
        assertSame(container, manager.getSelectedEditor(file)?.component)
        assertTrue(coroutines.pumpUntil { edtWait {
            container.components.singleOrNull()?.let { it !== old } == true
        } })
        assertEquals(1, manager.openFiles.size)
        assertSame(file, manager.selectedFiles.single())
        assertSame(container, manager.getSelectedEditor(file)?.component)
        assertTrue(Disposer.isDisposed(old as Disposable))
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
        val menu = descriptor.elements("group").single { it.attribute("id") == "Kilo.Worktree.RowMenu" }
        val order = (0 until menu.childNodes.length).mapNotNull { menu.childNodes.item(it) as? Element }.map {
            if (it.tagName == "separator") "separator" else it.attribute("ref")
        }
        assertEquals(listOf(
            "Kilo.Worktree.OpenPr",
            "Kilo.HostedWorkspace.Reload",
            "separator",
        ), order.take(3))
        assertEquals("Reload", KiloBundle.optional("action.$ID.text"))
        assertFalse(KiloBundle.optional("action.$ID.description").isNullOrBlank())
    }

    private fun event(
        facade: AgentManagerFacade? = this.facade,
        element: AgentManagerElement? = this.element,
    ): AnActionEvent {
        val context = DataContext { id ->
            when {
                AgentManagerKeys.FACADE.`is`(id) -> facade
                AgentManagerKeys.ELEMENT.`is`(id) -> element
                else -> null
            }
        }
        return AnActionEvent.createFromDataContext(ActionPlaces.POPUP, Presentation(), context)
    }

    private fun update(event: AnActionEvent) = edtWait { ActionUtil.updateAction(action, event) }

    private class FakeRpc(private val dto: HostedWorkspaceDto) : KiloHostedRpcApi {
        override suspend fun workspaceChanges(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("unused")
        override suspend fun refreshWorkspaceChanges(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("unused")
        override suspend fun workspaceChangeFile(ref: HostedWorkspaceRefDto, path: String, scope: String?, expectedRevision: Long, organizationID: String?): Nothing = error("unused")
        override suspend fun workspacePullRequestDiff(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("unused")
        override suspend fun workspacePullRequestDiffFile(ref: HostedWorkspaceRefDto, path: String, expectedHeadSha: String, organizationID: String?): Nothing = error("unused")
        override suspend fun workspacePullRequest(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedWorkspacePullRequestDto(ref, "unavailable", null)
        override suspend fun refreshWorkspacePullRequest(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedWorkspacePullRequestDto(ref, "unavailable", null)
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
