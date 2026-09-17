package ai.kilocode.client.session.board

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.BoardMessageDto
import ai.kilocode.rpc.dto.SessionBoardDto
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.WindowManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.JBList
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.UIUtil
import javax.swing.JComponent
import javax.swing.JEditorPane
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.event.MouseEvent

@Suppress("UnstableApiUsage")
class SessionBoardDialogTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var service: KiloSessionService
    private var dialog: SessionBoardDialog? = null
    private val opened = mutableListOf<Pair<String, String?>>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        service = KiloSessionService(project, scope, rpc)
    }

    override fun tearDown() {
        try {
            dialog?.let { d -> edt { Disposer.dispose(d.disposable) } }
            dialog = null
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test empty board shows empty text and disables reset`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        flushUntil { edt { !d.resetButton.isEnabled } }

        edt {
            assertFalse(d.loadMoreButton.isVisible)
            assertFalse(d.resetButton.isEnabled)
        }
    }

    fun `test loaded messages render route title body description and type badge`() {
        rpc.board = board(
            messages = listOf(
                message("m1", from = "main", to = "ALL", fromLabel = "Main", toLabel = null, type = "INFO", body = "status\nupdate"),
            ),
            hasMore = false,
        )
        val d = open()

        flushUntil { edt { itemCount(d) > 0 } }

        edt {
            val items = items(d)
            assertEquals(1, items.size)
            assertEquals("Main \u2192 ALL", items[0].title)
            assertEquals("status update", items[0].description)
            assertEquals("INFO", items[0].badges.single().text)
        }
    }

    fun `test hasMore shows load more and paging prepends older messages`() {
        rpc.board = board(messages = listOf(message("m2", body = "second")), hasMore = true, cursor = "m2")
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }

        rpc.board = board(messages = listOf(message("m1", body = "first")), hasMore = false)
        edt { d.loadMoreButton.doClick() }
        flushUntil { edt { itemCount(d) == 2 } }

        edt {
            assertEquals(listOf("first", "second"), items(d).map { it.description })
            assertFalse(d.loadMoreButton.isVisible)
            // First load has no cursor; the "Load more" click forwards the page's cursor as `before`.
            assertEquals(listOf(null, "m2"), rpc.sessionBoardCalls.map { it.second })
        }
    }

    fun `test reset declined leaves the board unchanged`() {
        rpc.board = board(messages = listOf(message("m1", body = "keep")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }
        edt { d.confirmReset = { _, _ -> false } }

        edt { d.resetButton.doClick() }
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(rpc.resetSessionBoardCalls.isEmpty())
        edt { assertEquals(1, itemCount(d)) }
    }

    fun `test reset accepted clears the board`() {
        rpc.board = board(messages = listOf(message("m1", body = "gone")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }
        edt { d.confirmReset = { _, _ -> true } }
        rpc.board = board(messages = emptyList(), hasMore = false, revision = 2)

        edt { d.resetButton.doClick() }
        flushUntil { edt { itemCount(d) == 0 } }

        assertEquals(listOf("ses_test" to 1), rpc.resetSessionBoardCalls)
    }

    fun `test reset conflict reloads instead of clearing blindly`() {
        rpc.board = board(messages = listOf(message("m1", body = "still here")), hasMore = false, revision = 1)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }
        edt { d.confirmReset = { _, _ -> true } }
        rpc.resetSessionBoardReturnsConflict = true

        edt { d.resetButton.doClick() }
        flushUntil { edt { rpc.resetSessionBoardCalls.isNotEmpty() } }
        // The dialog reloads after a conflict rather than trusting the null result.
        flushUntil { edt { itemCount(d) == 1 } }

        edt { assertEquals("still here", items(d).single().description) }
    }

    fun `test clicking a non-main participant closes the dialog and opens the agent`() {
        rpc.board = board(
            messages = listOf(message("m1", from = "ses_child", to = "main", fromLabel = "Explorer", body = "found it")),
            hasMore = false,
        )
        val d = open(order = listOf("main", "ses_child"))
        flushUntil { edt { itemCount(d) == 1 } }

        edt { d.list.select("m1") }
        UIUtil.dispatchAllInvocationEvents()
        // Route the click the same way a user click would, through the list's onClick callback.
        edt { clickRow(d, "m1") }

        assertEquals(listOf("ses_child" to "Explorer"), opened)
        assertEquals(com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE, d.exitCode)
    }

    fun `test clicking the main participant does not close the dialog`() {
        rpc.board = board(messages = listOf(message("m1", from = "main", to = "ALL", body = "note")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }

        edt { clickRow(d, "m1") }

        assertTrue(opened.isEmpty())
    }

    private fun open(
        order: List<String> = listOf("main"),
        sessionTitle: String? = "Test Session",
    ): SessionBoardDialog = edt {
        SessionBoardDialog(
            JBPanel<Nothing>(),
            project,
            "ses_test",
            sessionTitle,
            "/repo",
            order,
            service,
        ) { id, label -> opened.add(id to label) }
    }.also { dialog = it }

    private fun board(
        messages: List<BoardMessageDto>,
        hasMore: Boolean,
        cursor: String? = null,
        revision: Int = 1,
    ) = SessionBoardDto(ownerSessionID = "ses_test", revision = revision, messages = messages, cursor = cursor, hasMore = hasMore)

    private fun message(
        id: String,
        from: String = "main",
        to: String = "ALL",
        fromLabel: String? = null,
        toLabel: String? = null,
        type: String = "INFO",
        body: String = "body",
    ) = BoardMessageDto(id = id, timestamp = 0, from = from, to = to, fromLabel = fromLabel, toLabel = toLabel, type = type, body = body)

    // The list has no public "all items" accessor (only selection-based reads), so tests read the
    // live JList model directly off the real component tree, matching the convention used by other
    // dialog tests in this plugin (e.g. AgentManagerPanelTest).
    /**
     * The board stays usable while the session and its subagents keep working, so it must not block
     * the IDE. This also pins the contract that callers use `show()`, since `showAndGet()` throws on
     * a non-modal dialog.
     */
    fun `test dialog is non-modal`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt { assertFalse(d.isModal) }
    }

    fun `test window title carries the session name`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open(sessionTitle = "Locate session status logic")

        edt { assertEquals("Kilo Swarm \u2014 Locate session status logic", d.title) }
    }

    fun `test window title falls back to the product name without a session title`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open(sessionTitle = null)

        edt { assertEquals("Kilo Swarm", d.title) }
    }

    fun `test window title falls back when the session title is blank`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open(sessionTitle = "   ")

        edt { assertEquals("Kilo Swarm", d.title) }
    }

    fun `test banner starts collapsed with the short explanation only`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt {
            val text = bannerText(d)
            assertTrue("expected the short intro", text.contains("board agents share to talk to each other."))
            assertFalse("subagent detail belongs to the expanded view", text.contains("post here to exchange"))
            assertFalse("long explanation must stay hidden", text.contains("routing hint"))
            // The div width is what makes the HTML pane wrap instead of reporting one long line.
            assertTrue("banner must carry a wrap width", text.contains("<div width="))
            assertEquals("Show more", toggleLink(d).text)
        }
    }

    fun `test collapsed banner shows exactly one sentence`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt {
            // Strip the HTML wrapper the dialog adds, then count sentence terminators.
            val prose = bannerText(d).replace(Regex("<[^>]+>"), "").trim()
            assertEquals("collapsed intro should be one sentence: $prose", 1, prose.count { it == '.' })
            assertTrue("sentence should be terminated", prose.endsWith("."))
        }
    }

    fun `test expanding reveals the long explanation and flips the link`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt { toggleLink(d).doClick() }

        edt {
            val text = bannerText(d)
            assertTrue("short intro stays", text.contains("board agents share to talk to each other."))
            assertTrue("moved sentence appears", text.contains("post here to exchange"))
            assertTrue("long explanation appears", text.contains("routing hint"))
            assertEquals("Show less", toggleLink(d).text)
        }
    }

    fun `test collapsing hides the long explanation again`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt { toggleLink(d).doClick() }
        edt { toggleLink(d).doClick() }

        edt {
            assertFalse("long explanation hidden again", bannerText(d).contains("routing hint"))
            assertEquals("Show more", toggleLink(d).text)
        }
    }

    fun `test banner is an info status platform banner`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt {
            val banner = UIUtil.findComponentOfType(center(d), InlineBanner::class.java)
            assertNotNull("expected a platform InlineBanner", banner)
            assertEquals(EditorNotificationPanel.Status.Info, banner!!.status)
        }
    }

    /** The center panel is the list's direct parent — see `createCenterPanel`. */
    private fun center(d: SessionBoardDialog): JComponent = d.list.parent as JComponent

    /**
     * The banner renders its message in an HTML [JEditorPane]; the field itself is protected.
     * Whitespace is normalized because the pane re-serializes the document through
     * `HTMLWriter`, which hard-wraps long lines and would otherwise split a sentence mid-assertion.
     */
    private fun bannerText(d: SessionBoardDialog): String {
        val banner = UIUtil.findComponentOfType(center(d), InlineBanner::class.java) ?: error("no banner")
        val pane = UIUtil.findComponentOfType(banner, JEditorPane::class.java) ?: error("no banner text")
        return pane.text.replace(Regex("\\s+"), " ")
    }

    private fun toggleLink(d: SessionBoardDialog): LinkLabel<*> {
        val banner = UIUtil.findComponentOfType(center(d), InlineBanner::class.java) ?: error("no banner")
        return UIUtil.findComponentsOfType(banner, LinkLabel::class.java)
            .first { it.text == "Show more" || it.text == "Show less" }
    }

    private fun itemCount(d: SessionBoardDialog): Int = items(d).size

    private fun items(d: SessionBoardDialog): List<ActiveListItem> {
        val list = jList(d) ?: return emptyList()
        return (0 until list.model.size).map { list.model.getElementAt(it) }
    }

    private fun jList(d: SessionBoardDialog): JBList<ActiveListItem>? =
        UIUtil.findComponentOfType(d.list, JBList::class.java) as JBList<ActiveListItem>?

    private fun clickRow(d: SessionBoardDialog, key: String) {
        val list = jList(d) ?: error("board list not found")
        list.setSize(400, 400)
        list.doLayout()
        val index = (0 until list.model.size).first { list.model.getElementAt(it).key == key }
        val bounds = list.getCellBounds(index, index)
        fire(list, MouseEvent(
            list,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            bounds.x + 8,
            bounds.y + bounds.height / 2,
            1,
            false,
            MouseEvent.BUTTON1,
        ))
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(200) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue(done())
    }
}
