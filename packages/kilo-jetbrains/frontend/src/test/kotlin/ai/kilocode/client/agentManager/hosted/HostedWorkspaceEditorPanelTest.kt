package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel
import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import ai.kilocode.client.agentManager.WorkspaceSessionListToggle
import ai.kilocode.client.agentManager.WorkspaceSessionRow
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListBadgeCell
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.list.activeListLayout
import javax.swing.SwingUtilities
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.session.ui.ProgressPanel
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.util.edtWait
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
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
import com.intellij.ide.util.PropertiesComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import java.awt.Component
import java.awt.Container
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import javax.swing.JComponent
import javax.swing.KeyStroke

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
        assertTrue(coroutines.pumpUntil { edtWait {
            badge().segments.single().text == "Sleeping" && descendants(panel).any { it is SessionUi }
        } })
        edtWait { toggle() }
    }

    override fun tearDown() {
        try {
            edtWait { Disposer.dispose(panel) }
            edtWait { PropertiesComponent.getInstance(project).unsetValue("kilo.hosted.sessionList.${ref.key}") }
            coroutines.close()
        } finally { super.tearDown() }
    }

    fun testPreparationIsMountedAndComputeFollowsLiveEventsWithoutRefresh() {
        emit(HostedSystemEventDto(key, "cloud.status", step = "allocate", message = "Preparing compute",
            cloudStatus = "preparing", observedAt = 110.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Starting" } })
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
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Setting Up" } })
        edtWait { assertSame(ai.kilocode.client.ui.UiStyle.Badge.Secondary, badge().segments.single().style) }
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 210.0))
        assertTrue(coroutines.pumpUntil { edtWait { !footer.isVisible } })
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Active" } })
        assertEquals("running", hosted.state.value.statuses[ref.key]?.computeStatus)
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", sandboxDetail = "sandbox_stopped", observedAt = 300.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Sleeping" } })
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

    fun testCloudUsesSharedEditorHeaderRowsAndWorktreeSessionStyling() {
        edtWait {
            assertEquals(WorkspaceSessionEditorPanel::class.java, panel.javaClass.superclass)
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            assertEquals(0.25f, splitter.proportion, 0.01f)
            assertNotNull(descendants(panel).filterIsInstance<WorkspaceSessionHeader>().single())
            val list = descendants(panel).filterIsInstance<JBList<*>>().single()
            val rows = (0 until list.model.size).map { list.model.getElementAt(it) as ActiveListItem }
            assertTrue(rows.all { it is WorkspaceSessionRow })
            assertEquals(listOf("${ref.key}:selected", "${ref.key}:other"), rows.map { it.key })
            assertEquals(HistoryTime.title(HistorySection.OLDER), rows.first().section)
            assertEquals("New session", rows.last().title)
            @Suppress("UNCHECKED_CAST")
            val view = list as JBList<ActiveListItem>
            val cell = view.cellRenderer.getListCellRendererComponent(view, rows.first(), 0, false, false)
            val title = ai.kilocode.client.testing.rowTitle(cell)
            val iter = title.iterator()
            iter.next()
            assertEquals(SimpleTextAttributes.STYLE_PLAIN, iter.textAttributes.style)
        }
    }

    fun testHeaderUsesTheRowBadgeAndSeparateHourlyPriceWithoutRefreshControl() {
        val cell = edtWait { descendants(panel).filterIsInstance<ActiveListBadgeCell>().single { it.cellId == "cloud-compute" } }
        val initial = edtWait { badge() }
        val header = edtWait { descendants(panel).filterIsInstance<WorkspaceSessionHeader>().single() }
        val count = edtWait { descendants(header).size }
        edtWait {
            assertTrue(descendants(header).filterIsInstance<HoverIcon>().isEmpty())
            val price = descendants(header).filterIsInstance<JBLabel>().single { it.text == "$1.20/h" }
            val row = HostedWorkspaceRow(HostedWorkspaceRowData(HostedWorkspaceDto(ref), hosted.state.value.presentation(ref)))
            assertEquals(row.badges.single().text, initial.segments.single().text)
            assertSame(row.badges.single().style, initial.segments.single().style)
            header.setSize(900, header.preferredSize.height)
            activeListLayout(header)
            val pill = SwingUtilities.convertRectangle(cell.parent, cell.bounds, header)
            val title = descendants(header).filterIsInstance<SimpleColoredComponent>().single()
            val name = SwingUtilities.convertRectangle(title.parent, title.bounds, header)
            val label = SwingUtilities.convertRectangle(price.parent, price.bounds, header)
            assertTrue("Status sits in the trailing action group", pill.x > header.width / 2)
            assertTrue("Status stays clear of the title", pill.x > name.x + name.width)
            assertTrue("Price follows the status badge", label.x > pill.x + pill.width)
            assertTrue(descendants(header).filterIsInstance<JBLabel>().none { it.text.orEmpty().contains(" · ") })
        }
        repeat(100) {
            emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "active",
                sandboxDetail = "sandbox_ready", observedAt = 200.0 + it * 2))
            assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Active" } })
            emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping",
                sandboxDetail = "sandbox_stopped", observedAt = 201.0 + it * 2))
            assertTrue(coroutines.pumpUntil { edtWait { badge().segments.single().text == "Sleeping" } })
            edtWait { assertSame(cell, descendants(panel).filterIsInstance<ActiveListBadgeCell>().single { it.cellId == "cloud-compute" }) }
        }
        edtWait { assertEquals("Sleeping", badge().segments.single().text); assertEquals(count, descendants(header).size) }
    }

    fun testInitialPlaceholderIsCenteredInTheEditor() {
        edtWait {
            val second = HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace")
            try {
                val label = descendants(second).filterIsInstance<JBLabel>()
                    .single { it.text == KiloBundle.message("hosted.workspace.empty") }
                val area = label.parent
                area.setSize(400, 300)
                area.doLayout()
                assertTrue("Horizontal centre: label=${label.bounds} area=${area.size}",
                    kotlin.math.abs((area.width - label.width) / 2 - label.x) <= 1)
                assertTrue("Vertical centre: label=${label.bounds} area=${area.size}",
                    kotlin.math.abs((area.height - label.height) / 2 - label.y) <= 1)
            } finally {
                Disposer.dispose(second)
            }
        }
    }

    fun testCloudListVisibilityUsesSharedToggleAndRetainsSessionAndHeader() {
        edtWait {
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            val list = splitter.firstComponent
            val title = descendants(panel).filterIsInstance<SimpleColoredComponent>().first()
            val session = descendants(panel).filterIsInstance<SessionUi>().single()
            repeat(100) {
                toggle()
                assertNull(splitter.firstComponent)
                assertSame(session, descendants(panel).filterIsInstance<SessionUi>().single())
                toggle()
                assertSame(list, splitter.firstComponent)
                assertSame(title, descendants(panel).filterIsInstance<SimpleColoredComponent>().first())
            }
            assertEquals("true", PropertiesComponent.getInstance(project).getValue("kilo.hosted.sessionList.${ref.key}"))
        }
    }

    fun testPreferredFocusAlwaysBelongsToTheAttachedSharedEditorSurface() {
        edtWait {
            assertTrue(SwingUtilities.isDescendingFrom(panel.preferredFocus(), panel))
            toggle()
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            assertNull(splitter.firstComponent)
            assertSame(splitter.secondComponent, panel.preferredFocus())
            assertTrue(SwingUtilities.isDescendingFrom(panel.preferredFocus(), panel))
            assertTrue(descendants(splitter.secondComponent).any { it is SessionUi })
            toggle()
        }
    }

    fun testMissingCurrentSessionFallsBackToTheLatestAvailableSession() {
        rpc.rootSessions = listOf(rpc.rootSessions.last())

        hosted.refresh("/renamed-repository")

        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<JBList<*>>().single().selectedValue
                ?.let { (it as ActiveListItem).key == rpc.rootSessions.single().id } == true
        } })
        edtWait {
            assertEquals(rpc.rootSessions.single().id,
                (descendants(panel).filterIsInstance<JBList<*>>().single().selectedValue as ActiveListItem).key)
            assertEquals(1, descendants(panel).filterIsInstance<SessionUi>().size)
        }
    }

    fun testCurrentSessionIsReobservedAfterSignInRestoresTheGate() {
        val initial = rpc.collectors
        rpc.list = HostedWorkspaceListDto(signedOut = true)
        hosted.refresh("/signed-out")
        assertTrue(coroutines.pumpUntil { hosted.state.value.signedOut && rpc.active == 0 })

        rpc.list = HostedWorkspaceListDto(items = listOf(HostedWorkspaceDto(ref)))
        hosted.refresh("/signed-in")

        assertTrue(coroutines.pumpUntil { rpc.collectors > initial && rpc.active == 1 })
        emit(HostedSystemEventDto(key, "cloud.status", message = "Preparing after sign-in",
            cloudStatus = "preparing", observedAt = 500.0))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<ProgressPanel>().single().labelText() == "Preparing after sign-in"
        } })
    }

    fun testWorkspaceHeaderPullsBranchAndCustomNameFromWorkspaceMetadata() {
        val title = edtWait { descendants(panel).filterIsInstance<SimpleColoredComponent>().first() }
        edtWait { assertEquals("feature/cloud", title.getCharSequence(true).toString()) }
        rpc.name = "Cloud custom name"
        hosted.refresh(project.basePath.orEmpty())
        assertTrue(coroutines.pumpUntil { edtWait { title.getCharSequence(true).toString() == "Cloud custom name" } })
        edtWait { assertSame(title, descendants(panel).filterIsInstance<SimpleColoredComponent>().first()) }
    }

    fun testRefreshingWorkspaceMetadataRetitlesAndReusesTheOpenEditor() {
        val dto = HostedWorkspaceDto(ref, branch = "feature/cloud")
        val editors = FileEditorManager.getInstance(project)
        try {
            edtWait { openHostedWorkspace(project, dto, focus = false) }
            val file = edtWait { editors.openFiles.single() }
            edtWait {
                assertEquals("feature/cloud", file.name)
                assertEquals(mapOf("provider" to "cloud", "workspace" to "workspace"),
                    (file as ai.kilocode.client.vfs.KiloVirtualFile).path.params)
            }
            rpc.name = "Cloud renamed"
            hosted.refresh(project.basePath.orEmpty())
            assertTrue(coroutines.pumpUntil { edtWait { file.name == "Cloud renamed" } })
            edtWait {
                openHostedWorkspace(project, dto.copy(name = "Cloud renamed"), focus = false)
                assertSame(file, editors.openFiles.single())
                assertSame(file, KiloVirtualFileSystem.getInstance().cached(
                    ai.kilocode.client.vfs.KiloPath(HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto))))
            }
        } finally {
            edtWait {
                editors.openFiles.forEach { editors.closeFile(it) }
                service<KiloEditorKindRegistry>().unregister(HostedWorkspaceEditorKind.ID)
                KiloVirtualFileSystem.getInstance().clear()
            }
        }
    }

    private fun emit(event: HostedSystemEventDto) { assertTrue(rpc.events.tryEmit(event)) }
    private fun labels() = descendants(panel).filterIsInstance<JBLabel>().filter { it.text != null }
    private fun badge(): FilledBadgeIcon = descendants(panel).filterIsInstance<ActiveListBadgeCell>()
        .single { it.cellId == "cloud-compute" }.icon as FilledBadgeIcon
    private fun toggle() {
        val toggle = descendants(panel).filterIsInstance<WorkspaceSessionListToggle>().single()
        val key = toggle.getInputMap(JComponent.WHEN_FOCUSED).get(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0))
        toggle.actionMap.get(key).actionPerformed(ActionEvent(toggle, ActionEvent.ACTION_PERFORMED, ""))
    }
    private fun descendants(root: Component): List<Component> = listOf(root) +
        if (root is Container) root.components.flatMap { descendants(it) } else emptyList()

    private class FakeHosted(private val ref: HostedWorkspaceRefDto) : KiloHostedRpcApi {
        val events = MutableSharedFlow<HostedSystemEventDto>(replay = 16)
        var collectors = 0
        var active = 0
        var workspaceCalls = 0
        var name: String? = null
        var list = HostedWorkspaceListDto()
        var rootSessions = listOf(
            HostedWorkspaceSessionDto("${ref.key}:selected", "selected", "Selected session", updated = 2.0),
            HostedWorkspaceSessionDto("${ref.key}:other", "other", "New session - 2026-07-30T19:01:40.945Z", updated = 1.0),
        )
        override suspend fun providers(): List<HostedProviderDto> = emptyList()
        override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) = list
        override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto {
            workspaceCalls++
            return HostedWorkspaceDto(ref, name = name, branch = "feature/cloud", sessions = rootSessions)
        }
        override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 100.0, rateMicrodollarsPerHour = 1_200_000)
        override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = flow {
            collectors++
            active++
            try {
                events.collect { emit(it) }
            } finally {
                active--
            }
        }
    }
}
