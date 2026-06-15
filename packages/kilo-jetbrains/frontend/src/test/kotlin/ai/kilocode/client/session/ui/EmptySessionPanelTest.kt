package ai.kilocode.client.session.ui

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.BorderLayout
import java.awt.Cursor
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class EmptySessionPanelTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var workspace: Workspace
    private lateinit var controller: SessionController
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
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
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, scope, rpc)
        controller = SessionController(
            parent = testRootDisposable,
            ref = null,
            sessions = sessions,
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

    fun `test recent section is hidden when empty`() {
        val panel = panel()

        assertFalse(panel.recentVisible())
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

    fun `test feedback button uses localized text and icon`() {
        val panel = panel()

        assertEquals(KiloBundle.message("feedback.button"), panel.feedbackText())
        assertNotNull(panel.feedbackIcon())
    }

    fun `test action controls use hand cursor and no show history outline`() {
        val panel = panel()

        assertFalse(panel.showHistoryBorderPainted())
        assertFalse(panel.feedbackBorderPainted())
        assertEquals(Cursor.HAND_CURSOR, panel.showHistoryCursor())
        assertEquals(Cursor.HAND_CURSOR, panel.feedbackCursor())
        assertEquals(Cursor.HAND_CURSOR, panel.recent.list.cursor.type)
    }

    fun `test clicking show history delegates callback`() {
        var calls = 0
        val panel = panel(history = { calls++ })

        panel.clickShowHistory()

        assertEquals(1, calls)
    }

    fun `test feedback popup content opens expected destinations`() {
        val panel = panel()
        val opened = mutableListOf<String>()
        val content = panel.feedbackContent { opened.add(it) }
        val buttons = UIUtil.uiTraverser(content).filter(JButton::class.java).toList()

        assertEquals(
            listOf(
                KiloBundle.message("feedback.dialog.github"),
                KiloBundle.message("feedback.dialog.discord"),
                KiloBundle.message("feedback.dialog.support"),
            ),
            buttons.map { it.text },
        )

        buttons.forEach { it.doClick() }

        assertEquals(panel.feedbackUrls(), opened)
    }

    fun `test feedback discord action has icon`() {
        val panel = panel()
        val content = panel.feedbackContent()
        val discord = UIUtil.uiTraverser(content)
            .filter(JButton::class.java)
            .first { it.text == KiloBundle.message("feedback.dialog.discord") }

        assertNotNull(discord.icon)
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

    fun `test renderer uses title overlay`() {
        val panel = panel(
            recents = listOf(session("ses_1", title = "Stored")),
            titles = { mapOf("ses_1" to "Live") },
        )

        panel.syncActivity()
        val cell = panel.rendererComponent(session("ses_1", title = "Stored")) as BorderLayoutPanel

        assertEquals("Live", titleText(cell))
    }

    fun `test sync activity removes title overlay`() {
        var title = "Live"
        val panel = panel(
            recents = listOf(session("ses_1", title = "Stored")),
            titles = { title.takeIf { it.isNotBlank() }?.let { mapOf("ses_1" to it) }.orEmpty() },
        )

        panel.syncActivity()
        assertEquals("Live", titleText(panel.rendererComponent(session("ses_1", title = "Stored")) as BorderLayoutPanel))

        title = ""
        panel.syncActivity()

        assertEquals("Stored", titleText(panel.rendererComponent(session("ses_1", title = "Stored")) as BorderLayoutPanel))
    }

    fun `test renderer shows running badge for busy recent session`() {
        val panel = panel(listOf(session("ses_1")))
        rpc.statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        flush()
        panel.syncActivity()

        val cell = panel.rendererComponent(session("ses_1")) as BorderLayoutPanel

        assertEquals(KiloBundle.message("session.part.tool.running"), badgeText(cell))
    }

    fun `test renderer shows overlay badge for active recent session`() {
        val panel = panel(
            recents = listOf(session("ses_1")),
            activity = { sessions.activity() + mapOf("ses_1" to SessionActivityKind.QUESTION) },
        )
        rpc.statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        flush()
        panel.syncActivity()

        val cell = panel.rendererComponent(session("ses_1")) as BorderLayoutPanel

        assertEquals(KiloBundle.message("history.badge.question"), badgeText(cell))
    }

    fun `test sync activity updates recent badge kind change`() {
        var kind: SessionActivityKind? = null
        val panel = panel(
            recents = listOf(session("ses_1")),
            activity = { sessions.activity() + kind?.let { mapOf("ses_1" to it) }.orEmpty() },
        )
        rpc.statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        flush()

        panel.syncActivity()
        assertEquals(
            KiloBundle.message("session.part.tool.running"),
            badgeText(panel.rendererComponent(session("ses_1")) as BorderLayoutPanel),
        )

        kind = SessionActivityKind.QUESTION
        panel.syncActivity()

        assertEquals(
            KiloBundle.message("history.badge.question"),
            badgeText(panel.rendererComponent(session("ses_1")) as BorderLayoutPanel),
        )
    }

    fun `test renderer hides running badge for idle recent session`() {
        val panel = panel(listOf(session("ses_1")))
        rpc.statuses.value = mapOf("ses_1" to SessionStatusDto("idle"))
        flush()
        panel.syncActivity()

        val cell = panel.rendererComponent(session("ses_1")) as BorderLayoutPanel

        assertNull(badgeText(cell))
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

    private fun panel(
        recents: List<SessionDto> = emptyList(),
        history: () -> Unit = {},
        activity: () -> Map<String, SessionActivityKind> = { sessions.activity() },
        titles: () -> Map<String, String> = { emptyMap() },
    ) = EmptySessionPanel(testRootDisposable, controller, recents, history, activity, titles)

    private fun flush() = runBlocking {
        delay(100)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun badgeText(cell: BorderLayoutPanel): String? = UIUtil.uiTraverser(cell)
        .filter(JBLabel::class.java)
        .mapNotNull { (it.icon as? FilledBadgeIcon)?.takeIf { _ -> it.isVisible }?.text }
        .firstOrNull()

    private fun titleText(cell: BorderLayoutPanel): String? = UIUtil.uiTraverser(cell)
        .filter(JBLabel::class.java)
        .filter { it.icon == null }
        .firstOrNull()
        ?.text

    private fun session(id: String, updated: Long = 2_000L, title: String = "Title $id") = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/repo/$id",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = updated.toDouble()),
    )
}
