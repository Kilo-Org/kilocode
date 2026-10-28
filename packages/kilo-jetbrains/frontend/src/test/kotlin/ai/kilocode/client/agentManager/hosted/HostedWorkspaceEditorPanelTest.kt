package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.session.ui.ProgressPanel
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import java.awt.Component
import java.awt.Container

class HostedWorkspaceEditorPanelTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeHosted
    private lateinit var sessions: FakeSessionRpcApi
    private lateinit var hosted: KiloHostedService
    private lateinit var panel: HostedWorkspaceEditorPanel
    private val ref = HostedWorkspaceRefDto("cloud", "workspace")
    private val key get() = "${ref.key}:selected"

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeHosted(ref)
        sessions = FakeSessionRpcApi()
        hosted = KiloHostedService(coroutines.scope, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, sessions), testRootDisposable)
        val app = ApplicationManager.getApplication()
        app.replaceService(KiloAppService::class.java, KiloAppService(coroutines.scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        }), testRootDisposable)
        app.replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        }), testRootDisposable)
        panel = edtWait { HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace") }
        assertTrue(coroutines.pumpUntil { edtWait { labels().any { it.text.startsWith("sleeping") } } })
    }

    override fun tearDown() {
        try {
            edtWait { Disposer.dispose(panel) }
            coroutines.close()
        } finally { super.tearDown() }
    }

    fun testPreparationIsMountedAndComputeFollowsLiveEventsWithoutRefresh() {
        emit(HostedSystemEventDto(key, "cloud.status", step = "allocate", message = "Preparing compute",
            cloudStatus = "preparing", observedAt = 110.0))
        assertTrue(coroutines.pumpUntil { edtWait { labels().any { it.text.startsWith("starting") } } })
        val footer = edtWait { descendants(panel).filterIsInstance<ProgressPanel>().single() }
        edtWait {
            assertTrue(footer.isVisible)
            assertEquals("Preparing compute", footer.labelText())
            assertTrue(descendants(panel).filterIsInstance<SessionUi>().any {
                javax.swing.SwingUtilities.isDescendingFrom(footer, it)
            })
        }
        emit(HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_progress",
            message = "Cloning repository... Receiving objects: 33%", observedAt = 120.0))
        assertTrue(coroutines.pumpUntil { edtWait { footer.labelText().contains("33%") } })
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "running", sandboxDetail = "ready", observedAt = 200.0))
        assertTrue(coroutines.pumpUntil { edtWait { labels().any { it.text.startsWith("running") } } })
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 210.0))
        assertTrue(coroutines.pumpUntil { edtWait { !footer.isVisible } })
        assertEquals("running", hosted.state.value.statuses[ref.key]?.computeStatus)
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", sandboxDetail = "sandbox_stopped", observedAt = 300.0))
        assertTrue(coroutines.pumpUntil { edtWait { labels().any { it.text.startsWith("sleeping") } } })
        assertEquals(1, rpc.collectors)
        emit(HostedSystemEventDto(key, "cloud.status", message = "Preparing again",
            cloudStatus = "preparing", observedAt = 400.0))
        assertTrue(coroutines.pumpUntil { edtWait { footer.isVisible } })
        edtWait { assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single()) }
    }

    fun testSessionBadgesUpdateWithoutReloadingOrChangingSelection() {
        val list = edtWait { descendants(panel).filterIsInstance<JBList<*>>().single() }
        val selection = edtWait { (list.selectedValue as ActiveListItem).key }
        val other = "${ref.key}:other"
        sessions.statuses.value = mapOf(other to SessionStatusDto("busy"))
        assertTrue(coroutines.pumpUntil {
            edtWait { (0 until list.model.size).map { list.model.getElementAt(it) as ActiveListItem }
                .single { it.key == other }.badges.isNotEmpty() }
        })
        edtWait { assertEquals(selection, (list.selectedValue as ActiveListItem).key) }
        sessions.statuses.value = mapOf(other to SessionStatusDto("idle"))
        assertTrue(coroutines.pumpUntil {
            edtWait { (0 until list.model.size).map { list.model.getElementAt(it) as ActiveListItem }
                .single { it.key == other }.badges.isEmpty() }
        })
        assertEquals(1, rpc.workspaceCalls)
        assertEquals(1, rpc.collectors)
    }

    fun testPreparationFailureRemainsMountedAfterIdleAndRestartReusesFooter() {
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_failed", attemptID = "attempt_1",
            failure = "workspace_setup_failed", message = "Finishing setup", observedAt = 110.0, revision = 8))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<ProgressPanel>().any {
                it.isVisible && it.labelText().startsWith(KiloBundle.message("hosted.workspace.preparation.setupFailed"))
            }
        } })
        val footer = edtWait { descendants(panel).filterIsInstance<ProgressPanel>().single() }
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 120.0))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key) != null &&
            hosted.state.value.preparations[key]?.cloudStatus == "error" })
        edtWait {
            assertTrue(footer.isVisible)
            assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single())
        }
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_started", attemptID = "attempt_2",
            message = "New preparation", observedAt = 200.0, revision = 1))
        assertTrue(coroutines.pumpUntil { edtWait { footer.labelText() == "New preparation" } })
        edtWait { assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single()) }
        assertNull(hosted.state.value.failure(key))
        assertEquals("sleeping", hosted.state.value.statuses[ref.key]?.computeStatus)
    }

    private fun emit(event: HostedSystemEventDto) { assertTrue(rpc.events.tryEmit(event)) }
    private fun labels() = descendants(panel).filterIsInstance<JBLabel>()
    private fun descendants(root: Component): List<Component> = listOf(root) +
        if (root is Container) root.components.flatMap { descendants(it) } else emptyList()

    private class FakeHosted(private val ref: HostedWorkspaceRefDto) : KiloHostedRpcApi {
        val events = MutableSharedFlow<HostedSystemEventDto>(replay = 16)
        var collectors = 0
        var workspaceCalls = 0
        override suspend fun providers(): List<HostedProviderDto> = emptyList()
        override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) = HostedWorkspaceListDto()
        override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto {
            workspaceCalls++
            return HostedWorkspaceDto(ref, sessions = listOf(
                HostedWorkspaceSessionDto("${ref.key}:selected", "selected", "Selected session", updated = 2.0),
                HostedWorkspaceSessionDto("${ref.key}:other", "other", "Other session", updated = 1.0),
            ))
        }
        override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 100.0)
        override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = flow {
            collectors++
            events.collect { emit(it) }
        }
    }
}
