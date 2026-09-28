package ai.kilocode.client.session.board

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.PlainLabel
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.BoardMessageDto
import ai.kilocode.rpc.dto.SessionBoardDto
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.util.ui.UIUtil
import java.awt.datatransfer.DataFlavor
import java.awt.event.MouseEvent
import javax.accessibility.AccessibleRole
import javax.swing.JComponent
import javax.swing.JEditorPane
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

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

    fun `test empty board shows empty text and disables reset and copy`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        flushUntil { edt { !d.resetButton.isEnabled } }

        edt {
            assertFalse(d.loadMoreButton.isVisible)
            assertFalse(d.resetButton.isEnabled)
            assertFalse(d.copyButton.isEnabled)
        }
    }

    fun `test loaded messages render route header and Markdown body`() {
        rpc.board = board(
            messages = listOf(
                message(
                    "m1",
                    from = "main",
                    to = "ALL",
                    fromLabel = "Main",
                    body = "status **update**\n\n```kotlin\nval answer = 42\n```",
                ),
            ),
            hasMore = false,
        )
        val d = open()

        flushUntil { edt { itemCount(d) > 0 } }

        edt {
            val row = rows(d).single()
            assertEquals(listOf("Main \u2192 ALL"), route(row))
            assertTrue(html(row).contains("<strong>"))
            assertTrue(html(row).contains("update"))
            assertEquals("val answer = 42", editors(row).single().text)
        }
    }

    fun `test route uses stable unique icons for both endpoints`() {
        rpc.board = board(
            messages = listOf(
                message("m1", from = "ses_a", to = "ses_b", fromLabel = "Alpha", toLabel = "Beta"),
                message("m2", from = "ses_a", to = "main", fromLabel = "Alpha", toLabel = "Main"),
            ),
            hasMore = false,
        )
        val d = open(order = listOf("main", "ses_a", "ses_b"))
        flushUntil { edt { itemCount(d) == 2 } }

        edt {
            val rows = rows(d)
            val first = icons(rows[0])
            val second = icons(rows[1])
            assertEquals(2, first.size)
            assertEquals(2, second.size)
            assertSame(first[0], second[0])
            assertNotSame(first[0], first[1])
            assertNotSame(first[0], second[1])
        }
    }

    fun `test hasMore shows load more and paging prepends older messages`() {
        rpc.board = board(messages = listOf(message("m2", body = "second")), hasMore = true, cursor = "m2")
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }
        val retained = edt { rows(d).single() }

        rpc.board = board(messages = listOf(message("m1", body = "first")), hasMore = false)
        edt { d.loadMoreButton.doClick() }
        flushUntil { edt { itemCount(d) == 2 } }

        edt {
            assertEquals(listOf("first", "second"), rows(d).map(::body))
            assertSame(retained, rows(d)[1])
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

        edt { assertEquals("still here", body(rows(d).single())) }
    }

    fun `test clicking a non-main sender header opens the agent without closing the board`() {
        rpc.board = board(
            messages = listOf(message("m1", from = "ses_child", to = "main", fromLabel = "Explorer", body = "found it")),
            hasMore = false,
        )
        val d = open(order = listOf("main", "ses_child"))
        flushUntil { edt { itemCount(d) == 1 } }

        edt {
            val member = member(rows(d).single(), "Explorer")
            assertEquals(AccessibleRole.PUSH_BUTTON, member.accessibleContext.accessibleRole)
            assertTrue(member.isFocusable)
            clickMember(rows(d).single(), "Explorer")
        }

        assertEquals(listOf("ses_child" to "Explorer"), opened)
        // The board is modeless precisely so it can stay open while a subagent tab is opened
        // beside it; a click must never close it.
        edt { assertFalse(Disposer.isDisposed(d.disposable)) }
    }

    fun `test clicking a non-main recipient header opens the agent without closing the board`() {
        rpc.board = board(
            messages = listOf(message("m1", from = "main", to = "ses_child", toLabel = "Explorer", body = "go look")),
            hasMore = false,
        )
        val d = open(order = listOf("main", "ses_child"))
        flushUntil { edt { itemCount(d) == 1 } }

        edt { clickMember(rows(d).single(), "Explorer") }

        // `main -> agent` and `agent -> main` both open `agent`: only one side of the route can
        // ever be the non-"main"/"ALL" participant that is actually openable.
        assertEquals(listOf("ses_child" to "Explorer"), opened)
        edt { assertFalse(Disposer.isDisposed(d.disposable)) }
    }

    fun `test each subagent endpoint opens its own agent`() {
        rpc.board = board(
            messages = listOf(
                message(
                    "m1",
                    from = "ses_a",
                    to = "ses_b",
                    fromLabel = "Alpha",
                    toLabel = "Beta",
                    body = "handoff",
                ),
            ),
            hasMore = false,
        )
        val d = open(order = listOf("main", "ses_a", "ses_b"))
        flushUntil { edt { itemCount(d) == 1 } }

        edt {
            val row = rows(d).single()
            clickMember(row, "Alpha")
            clickMember(row, "Beta")
        }

        assertEquals(listOf("ses_a" to "Alpha", "ses_b" to "Beta"), opened)
    }

    fun `test clicking a route with only main or ALL opens nothing`() {
        rpc.board = board(messages = listOf(message("m1", from = "main", to = "ALL", body = "note")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }

        edt {
            val row = rows(d).single()
            assertTrue(UIUtil.findComponentsOfType(row, HoverArea::class.java).isEmpty())
            assertEquals(listOf("main", "ALL"), iconLabels(row).map { it.accessibleContext.accessibleName })
        }

        assertTrue(opened.isEmpty())
        edt { assertFalse(Disposer.isDisposed(d.disposable)) }
    }

    fun `test copy all fetches every page and copies oldest-first plain text`() {
        // Only the newest page is loaded into the dialog; "Copy all" must still walk backward
        // through every older page on its own, independent of what the dialog has paged in.
        rpc.board = board(messages = listOf(message("m3", from = "ses_a", to = "main", fromLabel = "Alpha", body = "third")), hasMore = true, cursor = "m3")
        val d = open(order = listOf("main", "ses_a"))
        flushUntil { edt { itemCount(d) == 1 } }

        rpc.boardPages = mapOf(
            null to board(messages = listOf(message("m3", from = "ses_a", to = "main", fromLabel = "Alpha", body = "third")), hasMore = true, cursor = "m3"),
            "m3" to board(messages = listOf(message("m2", body = "second")), hasMore = true, cursor = "m2"),
            "m2" to board(messages = listOf(message("m1", body = "first")), hasMore = false),
        )

        edt { d.copyButton.doClick() }
        flushUntil { edt { CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor) != null } }

        val expected = listOf(
            "main -> ALL [INFO]\nfirst",
            "main -> ALL [INFO]\nsecond",
            "Alpha -> main [INFO]\nthird",
        ).joinToString("\n\n")
        assertEquals(expected, CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor))
        edt { assertTrue(d.copyButton.isEnabled) }
    }

    fun `test copy all failure leaves clipboard untouched and re-enables the button`() {
        rpc.board = board(messages = listOf(message("m1", body = "keep")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }

        CopyPasteManager.getInstance().setContents(java.awt.datatransfer.StringSelection("unchanged"))
        rpc.sessionBoardThrows = RuntimeException("boom")

        edt { d.copyButton.doClick() }
        flushUntil { edt { d.copyButton.isEnabled } }

        assertEquals("unchanged", CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor))
    }

    fun `test copy all is disabled while a copy is already in progress`() {
        rpc.board = board(messages = listOf(message("m1", body = "keep")), hasMore = false)
        val d = open()
        flushUntil { edt { itemCount(d) == 1 } }

        edt { d.copyButton.doClick() }

        // The click above already dispatched to a coroutine but that coroutine has not been
        // resumed yet (no dispatcher pump between here and the assertion), so the button must
        // already read disabled from the synchronous `loading = true` the click performed.
        edt { assertFalse(d.copyButton.isEnabled) }
        flushUntil { edt { d.copyButton.isEnabled } }
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

    fun `test board scroll region is the accessible focus target`() {
        rpc.board = board(messages = emptyList(), hasMore = false)
        val d = open()

        edt {
            assertSame(d.scroll, d.preferredFocusedComponent)
            assertEquals("Kilo Swarm", d.scroll.accessibleContext.accessibleName)
            assertTrue(d.scroll.isFocusable)
        }
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

    /** The center panel is the scroll pane's direct parent — see `createCenterPanel`. */
    private fun center(d: SessionBoardDialog): JComponent = d.scroll.parent as JComponent

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

    private fun itemCount(d: SessionBoardDialog): Int = rows(d).size

    private fun rows(d: SessionBoardDialog): List<BoardMessageView> {
        val stack = d.messages.components.filterIsInstance<Stack>().single()
        return stack.components.filterIsInstance<BoardMessageView>()
    }

    private fun route(row: BoardMessageView): List<String> =
        UIUtil.findComponentsOfType(row, PlainLabel::class.java).map { it.text }

    private fun icons(row: BoardMessageView): List<javax.swing.Icon> = iconLabels(row).mapNotNull { it.icon }

    private fun iconLabels(row: BoardMessageView): List<JBLabel> =
        UIUtil.findComponentsOfType(row, JBLabel::class.java).filter { it.icon != null }

    private fun html(row: BoardMessageView): String =
        UIUtil.findComponentsOfType(row, JBHtmlPane::class.java).joinToString("\n") { it.text }

    private fun editors(row: BoardMessageView): List<EditorTextField> =
        UIUtil.findComponentsOfType(row, EditorTextField::class.java).toList()

    private fun body(row: BoardMessageView): String {
        val pane = UIUtil.findComponentsOfType(row, JBHtmlPane::class.java).single()
        return pane.document.getText(0, pane.document.length).trim()
    }

    private fun clickMember(row: BoardMessageView, title: String) {
        val area = member(row, title)
        val event = MouseEvent(
            area,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            1,
            1,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        area.mouseListeners.forEach { it.mouseClicked(event) }
    }

    private fun member(row: BoardMessageView, title: String): HoverArea =
        UIUtil.findComponentsOfType(row, HoverArea::class.java).single { item ->
            item.accessibleContext.accessibleName == title
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
