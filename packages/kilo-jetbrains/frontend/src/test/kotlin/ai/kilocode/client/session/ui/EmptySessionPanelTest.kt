package ai.kilocode.client.session.ui

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.awt.BorderLayout
import java.awt.Cursor

@Suppress("UnstableApiUsage")
class EmptySessionPanelTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var workspace: Workspace
    private lateinit var controller: SessionController
    private val opened = mutableListOf<String>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        app = KiloAppService(scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        })
        val workspaces = KiloWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
        controller = SessionController(
            parent = testRootDisposable,
            ref = null,
            sessions = KiloSessionService(project, scope, FakeSessionRpcApi()),
            workspace = workspace,
            app = app,
            cs = scope,
            open = { opened.add(it.id) },
        )
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test content is initialized immediately`() {
        val panel = panel()

        assertTrue(panel.initialized())
        assertFalse(panel.loadingVisible())
    }

    fun `test recent section remains visible when empty`() {
        val panel = panel()

        assertTrue(panel.recentVisible())
        assertEquals(0, panel.recentCount())
    }

    fun `test empty state has visible preferred height`() {
        val panel = panel()

        assertTrue(panel.preferredSize.height > 0)
    }

    fun `test description width is capped at DESCRIPTION_WIDTH`() {
        val panel = panel()

        assertEquals(
            com.intellij.util.ui.JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH),
            panel.descriptionPreferredSize().width,
        )
        assertEquals(
            com.intellij.util.ui.JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH),
            panel.descriptionMaximumSize().width,
        )
    }

    fun `test description label is centered`() {
        val panel = panel()

        assertEquals(javax.swing.SwingConstants.CENTER, panel.welcomeLabelAlignment())
    }

    fun `test show history button has its own preferred width`() {
        val panel = panel()
        val btn = panel.historyButtonPreferredWidth()

        assertTrue(btn > 0)
    }

    fun `test recent sessions are capped at five`() {
        val panel = panel((1..7).map { session("ses_$it") })

        assertTrue(panel.recentVisible())
        assertEquals(5, panel.recentCount())
    }

    fun `test explanation uses welcome message`() {
        val panel = panel()

        assertEquals(
            "Kilo Code is an AI coding assistant. Ask it to build features, fix bugs, or explain your codebase.",
            panel.explanationText(),
        )
    }

    fun `test selecting recent session does not open it`() {
        val panel = panel(listOf(session("ses_1"), session("ses_2")))

        panel.selectRecent(1)

        assertEquals(1, panel.selectedRecent())
        assertEquals(emptyList<String>(), opened)
    }

    fun `test clicking recent session delegates to controller`() {
        val panel = panel(listOf(session("ses_1"), session("ses_2")))

        panel.clickRecent(1)

        assertEquals(listOf("ses_2"), opened)
    }

    fun `test show history button uses localized text`() {
        val panel = panel()

        assertEquals(ai.kilocode.client.plugin.KiloBundle.message("session.showHistory"), panel.showHistoryText())
    }

    fun `test action controls use hand cursor and no show history outline`() {
        val panel = panel()

        assertFalse(panel.showHistoryBorderPainted())
        assertEquals(Cursor.HAND_CURSOR, panel.showHistoryCursor())
        assertEquals(Cursor.HAND_CURSOR, panel.recentCursor())
    }

    fun `test clicking show history delegates callback`() {
        var calls = 0
        val panel = panel(history = { calls++ })

        panel.clickShowHistory()

        assertEquals(1, calls)
    }

    fun `test renderer aligns title center and time east`() {
        val cell = panel().rendererComponent(session("ses_1")) as BorderLayoutPanel
        val layout = cell.layout as BorderLayout

        assertNotNull(layout.getLayoutComponent(BorderLayout.CENTER))
        assertNotNull(layout.getLayoutComponent(BorderLayout.EAST))
    }

    fun `test hover uses selection colors`() {
        val panel = panel()
        val session = session("ses_1")
        val selected = panel.rendererComponent(session, selected = true) as BorderLayoutPanel
        val hovered = panel.rendererComponent(session, hover = true) as BorderLayoutPanel

        assertTrue(selected.isOpaque)
        assertTrue(hovered.isOpaque)
        assertEquals(selected.background, hovered.background)
    }

    fun `test renderer reuses history title fallback`() {
        val cell = panel().rendererComponent(session("ses_1", title = "")) as BorderLayoutPanel
        val label = UIUtil.uiTraverser(cell).filter(JBLabel::class.java).firstOrNull()

        assertEquals("Untitled", label?.text)
    }

    fun `test timestamp normalization handles seconds and milliseconds`() {
        assertEquals(1_700_000_000_000L, HistoryTime.millis(LocalHistoryItem(session("ses_1", 1_700_000_000))))
        assertEquals(1_700_000_000_000L, HistoryTime.millis(LocalHistoryItem(session("ses_1", 1_700_000_000_000))))
    }

    fun `test timestamp renders coarse relative text`() {
        val panel = panel()
        val now = 1_700_000_000_000L

        assertEquals("Moments ago", panel.text(session("ses_1", now - 30_000), now))
        assertEquals("2 min ago", panel.text(session("ses_1", now - 120_000), now))
        assertEquals("3h ago", panel.text(session("ses_1", now - 10_800_000), now))
        assertEquals("4d ago", panel.text(session("ses_1", now - 345_600_000), now))
    }

    private fun panel(recents: List<SessionDto> = emptyList(), history: () -> Unit = {}) =
        EmptySessionPanel(testRootDisposable, controller, recents, history)

    private fun session(id: String, updated: Long = 2_000L, title: String = "Title $id") = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/repo/$id",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = updated.toDouble()),
    )
}
