package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.KiloTelemetryService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
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
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.w3c.dom.Element

@Suppress("UnstableApiUsage")
class RefreshHostedWorkspaceActionTest : BasePlatformTestCase() {
    companion object {
        private const val WAIT = 5_000L
        private const val ID = "Kilo.HostedWorkspace.Refresh"
        private const val REMOTE = "https://example.test/owner/repository"
    }

    private val dto = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "workspace"))
    private val action = RefreshHostedWorkspaceAction()
    private val resolved = CompletableDeferred<String>()
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeRpc
    private lateinit var hosted: KiloHostedService
    private var enabled = true

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeRpc(dto)
        hosted = KiloHostedService(scope, rpc, gate = { enabled }, log = TestLog(), repo = {
            resolved.complete(it)
            REMOTE
        })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        ApplicationManager.getApplication().replaceService(
            KiloTelemetryService::class.java,
            KiloTelemetryService(scope, FakeAppRpcApi()),
            testRootDisposable,
        )
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test refresh hides and does nothing without a project`() {
        val event = event(project = false)

        update(event)
        action.actionPerformed(event)

        assertFalse(event.presentation.isVisible)
        assertFalse(event.presentation.isEnabled)
        assertEquals(0L, hosted.refreshes.value)
        assertFalse(resolved.isCompleted)
    }

    fun `test refresh hides and does nothing without a Cloud workspace DTO`() {
        val event = event(workspace = null)

        update(event)
        action.actionPerformed(event)

        assertFalse(event.presentation.isVisible)
        assertFalse(event.presentation.isEnabled)
        assertEquals(0L, hosted.refreshes.value)
        assertFalse(resolved.isCompleted)
    }

    fun `test refresh is visible and enabled for a Cloud row without starting discovery`() {
        val event = event()

        update(event)

        assertTrue(event.presentation.isVisible)
        assertTrue(event.presentation.isEnabled)
        assertEquals(ActionUpdateThread.BGT, action.actionUpdateThread)
        assertFalse(resolved.isCompleted)
        assertFalse(rpc.reading.isCompleted)
    }

    fun `test refresh stays visible but disabled while loading and cannot restart discovery`() {
        hosted.refresh("/another/repository")
        runBlocking { withTimeout(WAIT) { rpc.reading.await() } }
        val event = event()

        update(event)
        action.actionPerformed(event)

        assertTrue(event.presentation.isVisible)
        assertFalse(event.presentation.isEnabled)
        assertEquals(1L, hosted.refreshes.value)
        assertEquals("/another/repository", runBlocking { resolved.await() })
    }

    fun `test disabling the Cloud gate hides refresh and blocks a stale click`() {
        val event = event()
        update(event)
        assertTrue(event.presentation.isEnabled)
        enabled = false

        action.actionPerformed(event)
        update(event)

        assertFalse(event.presentation.isVisible)
        assertFalse(event.presentation.isEnabled)
        assertEquals(0L, hosted.refreshes.value)
        assertFalse(resolved.isCompleted)
    }

    fun `test refresh discovers the project repository off the UI thread and re-enables when done`() {
        val event = event()

        action.actionPerformed(event)

        val request = runBlocking { withTimeout(WAIT) { rpc.reading.await() } }
        assertEquals(Triple(REMOTE, null, null), request)
        assertEquals(project.basePath.orEmpty(), runBlocking { resolved.await() })
        assertFalse(rpc.edt)
        assertEquals(1L, hosted.refreshes.value)
        assertTrue(hosted.state.value.loading)

        rpc.release.complete(Unit)
        val state = runBlocking { withTimeout(WAIT) { hosted.state.first { !it.loading } } }
        assertEquals(listOf(dto), state.items)
        assertNull(state.error)
        update(event)
        assertTrue(event.presentation.isEnabledAndVisible)
    }

    fun `test refresh is registered in the existing row menu with localized strings`() {
        val descriptor = PluginDescriptor.frontend()
        val declared = descriptor.elements("action").single { it.attribute("id") == ID }

        assertEquals(RefreshHostedWorkspaceAction::class.java.name, declared.attribute("class"))
        assertNull(declared.attribute("text"))
        assertNull(declared.attribute("description"))
        assertTrue(descriptor.elements("reference").any {
            it.attribute("ref") == ID && (it.parentNode as? Element)?.attribute("id") == "Kilo.Worktree.RowMenu"
        })
        assertEquals("Refresh", KiloBundle.optional("action.$ID.text"))
        assertFalse(KiloBundle.optional("action.$ID.description").isNullOrBlank())
        assertEquals("Local", KiloBundle.message("worktree.section.local"))
        assertEquals("Cloud", KiloBundle.message("worktree.section.cloud"))
        assertEquals("Unknown", KiloBundle.message("hosted.workspace.status.unknown"))
        val bundle = requireNotNull(javaClass.classLoader.getResourceAsStream("messages/KiloBundle.properties"))
            .bufferedReader().use { it.readText() }
        assertEquals(1, bundle.lineSequence().count { it.startsWith("hosted.workspace.status.unknown=") })
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

    private fun update(event: AnActionEvent) {
        ApplicationManager.getApplication().executeOnPooledThread {
            ActionUtil.updateAction(action, event)
        }.get()
    }

    private class FakeRpc(private val dto: HostedWorkspaceDto) : KiloHostedRpcApi {
        val reading = CompletableDeferred<Triple<String?, String?, String?>>()
        val release = CompletableDeferred<Unit>()
        var edt = false
            private set

        override suspend fun providers(): List<HostedProviderDto> = emptyList()

        override suspend fun workspaces(
            repositoryUrl: String?,
            cursor: String?,
            organizationID: String?,
        ): HostedWorkspaceListDto {
            edt = ApplicationManager.getApplication().isDispatchThread
            reading.complete(Triple(repositoryUrl, cursor, organizationID))
            release.await()
            return HostedWorkspaceListDto(items = listOf(dto))
        }

        override suspend fun workspace(
            ref: HostedWorkspaceRefDto,
            sessionCursor: String?,
            organizationID: String?,
        ): HostedWorkspaceDto = error("Refresh must use repository-scoped workspace discovery")

        override suspend fun workspaceStatus(
            ref: HostedWorkspaceRefDto,
            organizationID: String?,
        ): HostedWorkspaceStatusDto = HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 1.0)

        override suspend fun systemEvents(
            ref: HostedWorkspaceRefDto,
            sessionID: String,
            organizationID: String?,
        ): Flow<HostedSystemEventDto> = error("Workspaces without sessions need no event feed")
    }
}
