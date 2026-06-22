package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.AttachmentView
import ai.kilocode.client.session.views.PromptAttachmentView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.TextView
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.Container
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.ScrollPaneConstants

/**
 * Integration test: mutate [SessionModel] directly on the EDT and verify
 * that [SessionMessageListPanel] reflects the changes without any end-to-end RPC flow.
 *
 * This tests the full model → event → view update pipeline in isolation.
 */
@Suppress("UnstableApiUsage")
class SessionUiUpdateTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var panel: SessionMessageListPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        panel = SessionMessageListPanel(model, parent, openFile = {})
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    // ------ streaming text ------

    fun `test streaming text delta is reflected in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello "))
        model.appendDelta("a1", "p1", "world")

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("hello world", tv.markdown())
    }

    fun `test multiple deltas build up content correctly`() {
        model.upsertMessage(msg("a1", "assistant"))
        for (token in listOf("**T", "ok", "en**", " stream")) {
            model.appendDelta("a1", "p1", token)
        }

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("**Token** stream", tv.markdown())
        assertTrue(tv.md.html().contains("<strong>"))
    }

    // ------ full message lifecycle ------

    fun `test message added then parts then message updated`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "initial"))

        // Second MessageUpdated (e.g. token/cost meta) should not lose parts
        model.upsertMessage(msg("a1", "assistant"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
    }

    // ------ tool lifecycle ------

    fun `test tool state transitions are reflected in tool view`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "pending"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "running"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "completed"))

        val view = panel.findMessage("a1")!!.part("t1")
        val label = when (view) {
            is ShellToolView -> view.labelText()
            is ToolView -> view.labelText()
            else -> error("unexpected tool view ${view?.javaClass?.name}")
        }
        assertFalse(label.contains("Running"))
    }

    fun `test read tool renders as ReadToolView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("t1", "a1", "read", "completed"))

        val tv = panel.findMessage("a1")!!.part("t1")
        assertTrue(tv is ai.kilocode.client.session.views.tool.ReadToolView)
    }

    fun `test glob tool renders as GlobToolView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("t1", "a1", "glob", "completed"))

        val tv = panel.findMessage("a1")!!.part("t1")
        assertTrue(tv is ai.kilocode.client.session.views.tool.GlobToolView)
    }

    fun `test grep tool renders as SearchToolView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("t1", "a1", "grep", "completed"))

        val tv = panel.findMessage("a1")!!.part("t1")
        assertTrue(tv is ai.kilocode.client.session.views.tool.SearchToolView)
    }

    // ------ multiple turns update correctly ------

    fun `test content goes to correct turn when multiple turns exist`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.updateContent("a1", part("p1", "a1", "text", text = "turn1"))
        model.updateContent("a2", part("p2", "a2", "text", text = "turn2"))

        val t1text = (panel.findMessage("a1")!!.part("p1") as TextView).markdown()
        val t2text = (panel.findMessage("a2")!!.part("p2") as TextView).markdown()

        assertEquals("turn1", t1text)
        assertEquals("turn2", t2text)
    }

    // ------ compaction marker ------

    fun `test compaction part appears in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("cp1", "ses", "a1", "compaction"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("cp1"), mv.partIds())
        assertTrue(mv.part("cp1") is ai.kilocode.client.session.views.CompactionView)
    }

    // ------ generic fallback ------

    fun `test unknown part type falls back to GenericView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("g1", "ses", "a1", "snapshot"))

        val mv = panel.findMessage("a1")!!
        val gv = mv.part("g1")
        assertNotNull(gv)
        assertTrue(gv is ai.kilocode.client.session.views.base.GenericView)
        assertTrue((gv as ai.kilocode.client.session.views.base.GenericView).labelText().contains("snapshot"))
        assertNull(gv.border)
    }

    fun `test assistant file part renders as attachment view`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent(
            "a1",
            PartDto(
                id = "f1",
                sessionID = "ses",
                messageID = "a1",
                type = "file",
                mime = "image/png",
                url = "file:///tmp/a.png",
                filename = "a.png",
            ),
        )

        val view = panel.findMessage("a1")!!.part("f1")
        assertTrue(view is AttachmentView)
        assertEquals("AttachmentView#f1:a.png", view!!.dumpLabel())
        assertNotNull(find(view, AttachmentCard::class.java))
        assertFalse(buttons(view).any { it.accessibleContext.accessibleName == KiloBundle.message("prompt.attachment.remove", "a.png") })
    }

    fun `test user file part renders as prompt attachment strip`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent(
            "u1",
            PartDto(
                id = "f1",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "image/png",
                url = "file:///tmp/a.png",
                filename = "a.png",
            ),
        )

        val view = panel.findMessage("u1")!!.part("f1")
        assertTrue(view is PromptAttachmentView)
        assertEquals("PromptAttachmentView#attachments:u1[f1]", view!!.dumpLabel())
        assertNotNull(find(view, AttachmentCard::class.java))
        assertFalse(buttons(view).any { it.accessibleContext.accessibleName == KiloBundle.message("prompt.attachment.remove", "a.png") })
    }

    fun `test user text and attachments share one prompt container`() {
        val opened = mutableListOf<String>()
        val item = SessionMessageListPanel(model, parent, openFile = {}, openAttachment = { _, it -> opened.add(it.url) })
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "look at this"))
        model.updateContent(
            "u1",
            PartDto(
                id = "f1",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "image/png",
                url = "data:image/png;base64,aGVsbG8=",
                filename = "a.png",
            ),
        )
        model.updateContent(
            "u1",
            PartDto(
                id = "f2",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "text/plain",
                url = "data:text/plain;base64,aGVsbG8=",
                filename = "note.txt",
            ),
        )

        val msg = item.findMessage("u1")!!
        val attachment = msg.part("f1")!!
        val other = msg.part("f2")!!

        assertSame(msg, attachment.parent)
        assertSame(attachment, other)
        assertEquals(listOf("p1", "f1", "f2"), msg.partIds())
        assertEquals(1, msg.components.filterIsInstance<PromptAttachmentView>().size)
        assertEquals(2, findAll(attachment, AttachmentCard::class.java).size)

        val cards = findAll(attachment, AttachmentCard::class.java)
        for (card in cards) {
            card.dispatchEvent(MouseEvent(card, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false))
        }

        assertEquals(listOf("data:image/png;base64,aGVsbG8=", "data:text/plain;base64,aGVsbG8="), opened)
    }

    fun `test empty sanitized user text does not create prompt panel`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "read these screenshots"))
        model.updateContent("u1", part("p2", "u1", "text", text = "   "))
        model.updateContent(
            "u1",
            PartDto(
                id = "f1",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "image/png",
                url = "data:image/png;base64,aGVsbG8=",
                filename = "a.png",
            ),
        )

        val msg = panel.findMessage("u1")!!

        assertNull(msg.part("p2"))
        assertEquals(listOf("p1", "f1"), msg.partIds())
        assertTrue(msg.part("p1") is TextView)
        assertEquals(1, msg.components.filterIsInstance<PromptAttachmentView>().size)
    }

    fun `test prompt text panel is removed when content becomes empty`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "visible"))

        assertNotNull(panel.findMessage("u1")!!.part("p1"))

        model.updateContent("u1", part("p1", "u1", "text", text = ""))

        val msg = panel.findMessage("u1")!!
        assertNull(msg.part("p1"))
        assertTrue(msg.partIds().isEmpty())
        assertEquals(0, msg.components.filterIsInstance<TextView>().size)
    }

    fun `test user attachment strip scrolls horizontally only`() {
        model.upsertMessage(msg("u1", "user"))
        for (i in 1..8) {
            model.updateContent(
                "u1",
                PartDto(
                    id = "f$i",
                    sessionID = "ses",
                    messageID = "u1",
                    type = "file",
                    mime = "image/png",
                    url = "file:///tmp/$i.png",
                    filename = "$i.png",
                ),
            )
        }

        val view = panel.findMessage("u1")!!.part("f1") as PromptAttachmentView
        val height = view.preferredSize.height
        val pane = view.scrollPane()

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, pane.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, pane.verticalScrollBarPolicy)
        assertEquals(0, view.insets.top)
        assertEquals(JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING), view.insets.bottom)
        assertEquals(
            JBUI.scale(SessionUiStyle.View.Attachment.CARD_HEIGHT) +
                pane.horizontalScrollBar.preferredSize.height +
                JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            height,
        )

        model.updateContent(
            "u1",
            PartDto(
                id = "f9",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "image/png",
                url = "file:///tmp/9.png",
                filename = "9.png",
            ),
        )

        assertEquals(height, view.preferredSize.height)
        assertEquals((1..9).map { "f$it" }, view.ids())
    }

    fun `test user read tool payload is hidden but assistant read tool renders`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("u1", toolPart("ut1", "u1", "read", "completed"))
        model.updateContent("a1", toolPart("at1", "a1", "read", "completed"))

        val user = panel.findMessage("u1")!!
        val assistant = panel.findMessage("a1")!!

        assertTrue(user.partIds().isEmpty())
        assertNull(user.part("ut1"))
        assertTrue(assistant.part("at1") is ReadToolView)
    }

    fun `test transcript attachment click delegates to attachment opener`() {
        val opened = mutableListOf<Pair<String, String>>()
        val item = SessionMessageListPanel(model, parent, openFile = {}, openAttachment = { msg, it -> opened.add(msg to it.url) })
        model.upsertMessage(msg("u1", "user"))
        model.updateContent(
            "u1",
            PartDto(
                id = "f1",
                sessionID = "ses",
                messageID = "u1",
                type = "file",
                mime = "text/plain",
                url = "data:text/plain;base64,aGVsbG8=",
                filename = "note.txt",
            ),
        )

        val card = find(item.findMessage("u1")!!.part("f1")!!, AttachmentCard::class.java)!!
        card.dispatchEvent(MouseEvent(card, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false))

        assertEquals(listOf("u1" to "data:text/plain;base64,aGVsbG8="), opened)
    }

    // ------ silent part types ------

    fun `test step markers are not rendered in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("g1", "ses", "a1", "step-start"))
        model.updateContent("a1", PartDto("g2", "ses", "a1", "step-finish"))

        val mv = panel.findMessage("a1")!!
        assertTrue(mv.partIds().isEmpty())
    }

    // ------ history load ------

    fun `test loadHistory populates panel with correct turn structure and content`() {
        model.loadHistory(listOf(
            MessageWithPartsDto(
                msg("u1", "user"),
                listOf(part("pu1", "u1", "text", text = "can you help")),
            ),
            MessageWithPartsDto(
                msg("a1", "assistant"),
                listOf(part("pa1", "a1", "text", text = "sure")),
            ),
        ))

        assertEquals(1, panel.turnCount())
        assertEquals("turn#u1: user#u1, assistant#a1", panel.dump())

        val userText = (panel.findMessage("u1")!!.part("pu1") as TextView).markdown()
        val assistantText = (panel.findMessage("a1")!!.part("pa1") as TextView).markdown()
        assertEquals("can you help", userText)
        assertEquals("sure", assistantText)
    }

    // ------ regrouping triggered by remove ------

    fun `test removing user anchor updates panel structure`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))

        model.removeMessage("u1")

        // a1 now forms its own standalone turn; u2 still has its own
        assertEquals(2, panel.turnCount())
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#a1: assistant#a1", panel.findTurn("a1")?.let { "turn#${it.id}: ${it.dump()}" })
    }

    // ------ idle state hides docks ------

    fun `test StateChanged to Idle is handled without crash`() {
        model.setState(SessionState.Busy("thinking"))
        model.setState(SessionState.Idle)
        // SessionPanel itself does not render state — just ensure no exception
        assertTrue(true)
    }

    // ------ helpers ------

    private fun msg(id: String, role: String) = MessageDto(
        id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0),
    )

    private fun part(id: String, mid: String, type: String, text: String? = null) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = type, text = text,
    )

    private fun toolPart(id: String, mid: String, tool: String, state: String) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = "tool", tool = tool, state = state,
    )

    private fun <T : Any> find(root: java.awt.Component, type: Class<T>): T? {
        if (type.isInstance(root)) return type.cast(root)
        if (root is Container) {
            for (child in root.components) {
                val found = find(child, type)
                if (found != null) return found
            }
        }
        return null
    }

    private fun <T : Any> findAll(root: java.awt.Component, type: Class<T>): List<T> {
        val out = mutableListOf<T>()
        fun visit(node: java.awt.Component) {
            if (type.isInstance(node)) out.add(type.cast(node))
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun buttons(root: java.awt.Component): List<JButton> {
        val out = mutableListOf<JButton>()
        fun visit(node: java.awt.Component) {
            if (node is JButton) out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }
}
