package ai.kilocode.client.session.ui

import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.LoginRequiredView
import ai.kilocode.client.session.views.PlanExitView
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.views.MessageToolbar
import ai.kilocode.client.session.views.MessageView
import ai.kilocode.client.session.views.TextView
import ai.kilocode.client.session.views.TurnView
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.tool.TaskToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.session.views.todo.TodoWriteView
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.SessionRevertDto
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Point
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.SwingUtilities
import javax.swing.border.Border

/**
 * Tests for [SessionMessageListPanel] — structural and index integrity.
 *
 * Uses [BasePlatformTestCase] for a real IntelliJ Application; layout
 * is not measured (no screen), but the structural / index state is fully
 * testable.
 */
@Suppress("UnstableApiUsage")
class SessionMessageListPanelTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var panel: SessionMessageListPanel
    private val openFile: SessionFileOpener = { _, _ -> }

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        panel = SessionMessageListPanel(model, parent, openFile = openFile)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    // ------ initial state ------

    fun `test empty panel has no turns`() {
        assertEquals(0, panel.turnCount())
        assertEquals("", panel.dump())
    }

    fun `test transcript content has symmetric side padding`() {
        model.upsertMessage(msg("a1", "assistant"))

        panel.setSize(600, 400)
        panel.doLayout()
        val turn = panel.components.first { it is TurnView }
        val left = turn.x
        val right = panel.width - turn.x - turn.width

        assertEquals(right, left)
    }

    fun `test top level user turns use prompt gap after previous turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "first"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p2", "a1", "text", text = "answer"))
        model.upsertMessage(msg("u2", "user"))
        model.updateContent("u2", part("p3", "u2", "text", text = "second"))

        panel.setSize(600, 1000)
        layout(panel)
        val first = panel.findTurn("u1")!!
        val second = panel.findTurn("u2")!!

        assertEquals(
            JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_GAP),
            second.y - first.bounds.maxY.toInt(),
        )
    }

    // ------ TurnAdded ------

    fun `test user message creates turn and is findable by message id`() {
        model.upsertMessage(msg("u1", "user"))

        assertEquals(1, panel.turnCount())
        assertNotNull(panel.findMessage("u1"))
        assertEquals("user", panel.findMessage("u1")!!.role)
        assertEquals(panel.dump(), "turn#u1: user#u1")
    }

    fun `test assistant message added to existing turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        assertEquals(1, panel.turnCount())
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#u1: user#u1, assistant#a1", panel.dump())
    }

    fun `test second user message creates a second turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        assertEquals(2, panel.turnCount())
        assertNotNull(panel.findMessage("u2"))
        assertNotNull(panel.findMessage("a2"))
        assertEquals("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2, assistant#a2
        """.trimIndent().trim(), panel.dump())
    }

    fun `test turn view hides when all messages are reverted`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.setRevert(SessionRevertDto("u2"))

        assertTrue(panel.findTurn("u1")!!.isVisible)
        assertTrue(panel.findMessage("u1")!!.isVisible)
        assertFalse(panel.findTurn("u2")!!.isVisible)
        assertFalse(panel.findMessage("u2")!!.isVisible)
        assertFalse(panel.findMessage("a2")!!.isVisible)
    }

    fun `test turn view shows again when revert clears`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("u2", "user"))
        model.setRevert(SessionRevertDto("u2"))

        model.setRevert(null)

        assertTrue(panel.findTurn("u2")!!.isVisible)
        assertTrue(panel.findMessage("u2")!!.isVisible)
    }

    // ------ TurnRemoved ------

    fun `test removing only message removes the turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.removeMessage("u1")

        assertEquals(0, panel.turnCount())
        assertNull(panel.findMessage("u1"))
    }

    fun `test removing user anchor of two-message turn creates new standalone turn for assistant`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        model.removeMessage("u1")

        assertEquals(1, panel.turnCount())
        assertNull(panel.findMessage("u1"))
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#a1: assistant#a1", panel.dump())
    }

    fun `test removing middle user message merges turns`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.removeMessage("u2")

        assertEquals(1, panel.turnCount())
        assertNull(panel.findMessage("u2"))
        assertNotNull(panel.findMessage("a2"))  // now in u1's turn
        assertEquals("turn#u1: user#u1, assistant#a1, assistant#a2", panel.dump())
    }

    // ------ secondary index integrity ------

    fun `test findTurn returns the owning TurnView`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        val tv = panel.findTurn("a1")
        assertNotNull(tv)
        assertEquals("u1", tv!!.id)
    }

    fun `test indexes are null after message removal`() {
        model.upsertMessage(msg("u1", "user"))
        model.removeMessage("u1")

        assertNull(panel.findMessage("u1"))
        assertNull(panel.findTurn("u1"))
    }

    // ------ content events ------

    fun `test ContentAdded adds TextView to MessageView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    fun `test user prompt text part gets copy toolbar`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "hello"))

        val view = panel.findMessage("u1")!!.part("p1") as TextView
        val message = panel.findMessage("u1")!!
        val target = components(message).filterIsInstance<SessionCopyTarget>().single { it.copyToolbar != null }
        val toolbar = target.copyToolbar as MessageToolbar
        val placeholder = target.copyAnchor

        assertFalse(components(message).filterIsInstance<MessageToolbar>().any { it === toolbar })
        assertNull(toolbar.parent)
        assertFalse(view.hasCopyToolbar())
        assertTrue(message.promptToolbarActive())
        assertEquals(toolbar.preferredSize.width, placeholder.preferredSize.width)
        assertTrue(placeholder.preferredSize.height > toolbar.preferredSize.height)
    }

    fun `test user prompt toolbar omits rollback when revert handler is absent`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "hello"))

        val message = panel.findMessage("u1")!!
        val toolbar = components(message).filterIsInstance<SessionCopyTarget>().single { it.copyToolbar != null }.copyToolbar as MessageToolbar

        assertFalse(components(toolbar).filterIsInstance<JButton>().any { it.toolTipText == KiloBundle.message("revert.message.rollback") })
    }

    fun `test user prompt toolbar shows rollback when revert handler is present`() {
        var called: String? = null
        panel = SessionMessageListPanel(model, parent, openFile = openFile, revert = { called = it })
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", text = "hello"))

        val message = panel.findMessage("u1")!!
        val toolbar = components(message).filterIsInstance<SessionCopyTarget>().single { it.copyToolbar != null }.copyToolbar as MessageToolbar
        val rollback = components(toolbar)
            .filterIsInstance<JButton>()
            .first { it.toolTipText == KiloBundle.message("revert.message.rollback") }
        rollback.doClick()

        assertEquals(Cursor.HAND_CURSOR, rollback.cursor.type)
        assertEquals("u1", called)
    }

    fun `test latest non blank assistant text part gets copy toolbar`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "first"))
        model.updateContent("a1", part("p2", "a1", "text", text = "second"))

        val first = panel.findMessage("a1")!!.part("p1") as TextView
        val second = panel.findMessage("a1")!!.part("p2") as TextView

        assertFalse(first.hasCopyToolbar())
        assertTrue(second.hasCopyToolbar())
    }

    fun `test assistant copy toolbar moves back when latest text is removed`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "first"))
        model.updateContent("a1", part("p2", "a1", "text", text = "second"))
        val first = panel.findMessage("a1")!!.part("p1") as TextView

        model.removeContent("a1", "p2")

        assertTrue(first.hasCopyToolbar())
    }

    fun `test assistant copy target spans newest assistant message in turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("a2", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "first"))
        model.updateContent("a2", part("p2", "a2", "text", text = "second"))

        val first = panel.findMessage("a1")!!.part("p1") as TextView
        val second = panel.findMessage("a2")!!.part("p2") as TextView

        assertFalse(first.hasCopyToolbar())
        assertTrue(second.hasCopyToolbar())
    }

    fun `test text markdown link uses panel url opener`() {
        val urls = mutableListOf<String>()
        val item = SessionMessageListPanel(model, parent, openFile = openFile, openUrl = { urls.add(it) })
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "[docs](https://kilocode.ai/docs)"))

        val view = item.findMessage("a1")!!.part("p1") as TextView
        view.md.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("https://kilocode.ai/docs"), urls)
    }

    fun `test hover hook follows active part transitions`() {
        val events = mutableListOf<String>()
        val item = SessionMessageListPanel(
            model,
            parent,
            openFile = openFile,
        ).also {
            it.onHover = { view, on -> events.add("${view.contentId}:$on") }
        }
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("p1", "a1", "bash", "call1", input = mapOf("command" to "first")))
        model.updateContent("a1", toolPart("p2", "a1", "bash", "call2", input = mapOf("command" to "second")))
        val first = item.findMessage("a1")!!.part("p1") as PartView
        val second = item.findMessage("a1")!!.part("p2") as PartView

        first.setHovered(true)
        second.setHovered(true)
        first.setHovered(false)
        second.setHovered(false)

        assertEquals(listOf("p1:true", "p2:true", "p2:false"), events)
    }

    fun `test ContentDelta appends text to TextView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello "))
        model.appendDelta("a1", "p1", "world")

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("hello world", tv.markdown())
    }

    fun `test ContentDelta preserves TextView and markdown component`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "first\n\nsecond"))
        val mv = panel.findMessage("a1")!!
        val tv = mv.part("p1") as TextView
        val comp = tv.md.component
        val first = (comp as JPanel).components.first()

        model.appendDelta("a1", "p1", " more")

        assertSame(tv, mv.part("p1"))
        assertSame(comp, tv.md.component)
        assertSame(tv.copyButton(), (mv.part("p1") as TextView).copyButton())
        assertSame(first, comp.components.first())
        assertEquals("first\n\nsecond more", tv.markdown())
    }

    fun `test streaming assistant text keeps copy toolbar stable and bounded`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "start"))
        val mv = panel.findMessage("a1")!!
        val tv = mv.part("p1") as TextView
        val comp = tv.md.component
        val btn = tv.copyButton()
        val count = count(tv)

        repeat(200) { model.appendDelta("a1", "p1", " token$it") }

        assertSame(tv, mv.part("p1"))
        assertSame(comp, tv.md.component)
        assertSame(btn, tv.copyButton())
        assertEquals(count, count(tv))
        assertTrue(tv.hasCopyToolbar())
    }

    fun `test streaming new assistant text updates copy target without rebuilding previous text`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "first"))
        val first = panel.findMessage("a1")!!.part("p1") as TextView
        val comp = first.md.component
        val button = first.copyButton()

        model.appendDelta("a1", "p2", "second")

        val second = panel.findMessage("a1")!!.part("p2") as TextView
        assertSame(first, panel.findMessage("a1")!!.part("p1"))
        assertSame(comp, first.md.component)
        assertSame(button, first.copyButton())
        assertFalse(first.hasCopyToolbar())
        assertTrue(second.hasCopyToolbar())
    }

    fun `test prompt box paints at wrapped prompt coordinates`() {
        model.upsertMessage(msg("u1", "user"))
        model.updateContent("u1", part("file1", "u1", "file", text = null))
        model.updateContent("u1", part("p1", "u1", "text", text = "hello"))
        val message = panel.findMessage("u1")!!
        message.setSize(400, message.preferredSize.height)
        message.doLayout()
        layout(message)
        val box = promptBox(message)
        val point = SwingUtilities.convertPoint(box, Point(), message)
        assertTrue("prompt box should be below attachment", point.y > 0)

        val image = BufferedImage(message.width, message.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        message.paint(graphics)
        graphics.dispose()

        val line = SessionUiStyle.View.Outline.color().rgb
        assertEquals(line, Color(image.getRGB(point.x + box.width / 2, point.y), true).rgb)
        assertFalse(line == Color(image.getRGB(point.x + box.width / 2, 0), true).rgb)
    }

    fun `test created ContentDelta is not double applied`() {
        model.upsertMessage(msg("a1", "assistant"))

        model.appendDelta("a1", "p1", "hello")

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("hello", tv.markdown())
    }

    fun `test ContentRemoved removes PartView from MessageView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "x"))
        model.removeContent("a1", "p1")

        val mv = panel.findMessage("a1")!!
        assertTrue(mv.partIds().isEmpty())
    }

    fun `test child tool update refreshes collapsed task view without replacing it`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent(
            "a1",
            toolPart(
                "part_task",
                "a1",
                "task",
                "call_task",
                input = mapOf("subagent_type" to "explore", "description" to "Find files"),
                metadata = mapOf("sessionId" to "ses_child"),
            ),
        )
        model.upsertChildTool("ses_child", childTool("child_read", "read"))
        val view = panel.findMessage("a1")!!.part("part_task") as TaskToolView

        assertTrue(view.isExpanded())
        view.collapse()
        model.upsertChildTool("ses_child", childTool("child_read", "grep"))

        val updated = panel.findMessage("a1")!!.part("part_task") as TaskToolView
        assertSame(view, updated)
        assertFalse(updated.isExpanded())
        updated.expand()
        assertTrue(taskText(updated).single().contains("Grep"))
        assertTrue(taskText(updated).single().contains("pattern=query"))
    }

    // ------ HistoryLoaded ------

    fun `test HistoryLoaded rebuilds panel from scratch`() {
        // Prime with some messages
        model.upsertMessage(msg("u0", "user"))

        model.loadHistory(listOf(
            MessageWithPartsDto(msg("u1", "user"), emptyList()),
            MessageWithPartsDto(msg("a1", "assistant"), emptyList()),
            MessageWithPartsDto(msg("u2", "user"), emptyList()),
        ))

        assertNull(panel.findMessage("u0"))  // old message gone
        assertNotNull(panel.findMessage("u1"))
        assertNotNull(panel.findMessage("a1"))
        assertNotNull(panel.findMessage("u2"))
        assertEquals("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2
        """.trimIndent().trim(), panel.dump())
    }

    fun `test HistoryLoaded with parts populates MessageView content`() {
        model.loadHistory(listOf(
            MessageWithPartsDto(
                msg("a1", "assistant"),
                listOf(part("p1", "a1", "text", text = "preloaded")),
            ),
        ))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
        val tv = mv.part("p1") as TextView
        assertEquals("preloaded", tv.markdown())
    }

    // ------ Cleared ------

    fun `test Cleared wipes all panel state`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        model.clear()

        assertEquals(0, panel.turnCount())
        assertNull(panel.findMessage("u1"))
        assertNull(panel.findMessage("a1"))
        assertEquals("", panel.dump())
    }

    // ------ turn ordering ------

    fun `test turn insertion order is preserved`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("u3", "user"))

        assertEquals(listOf("u1", "u2", "u3"), panel.turnIds())
    }

    fun `test applyStyle updates existing transcript without rebuilding`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello"))
        val turn = panel.findTurn("a1")!!
        val message = panel.findMessage("a1")!!
        val text = message.part("p1") as TextView
        val comp = text.md.component
        val style = SessionEditorStyle.create(family = "Courier New", size = 24)

        panel.applyStyle(style)

        assertSame(turn, panel.findTurn("a1"))
        assertSame(message, panel.findMessage("a1"))
        assertSame(text, panel.findMessage("a1")!!.part("p1"))
        assertSame(comp, text.md.component)
        assertTrue(text.md.overrideSheet().contains(style.transcriptFont.name))
        assertTrue(text.md.overrideSheet().contains("Courier New"))
        assertTrue(text.md.overrideSheet().contains("24pt"))
    }

    fun `test new content after applyStyle uses queued style`() {
        model.upsertMessage(msg("a1", "assistant"))
        val style = SessionEditorStyle.create(family = "Courier New", size = 25)
        panel.applyStyle(style)

        model.updateContent("a1", part("p1", "a1", "text", text = "hello"))

        val text = panel.findMessage("a1")!!.part("p1") as TextView
        assertTrue(text.md.overrideSheet().contains(style.transcriptFont.name))
        assertTrue(text.md.overrideSheet().contains("Courier New"))
        assertTrue(text.md.overrideSheet().contains("25pt"))
    }

    // ------ active view tests ------

    fun `test active question is anchored before progress footer`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("u1", "user"))
        model.setState(SessionState.AwaitingQuestion(question()))

        val qv = find<QuestionView>(item)!!
        val pv = find<PermissionView>(item)!!
        val comps = item.components.toList()

        assertTrue(qv.isVisible)
        assertFalse(pv.isVisible)
        assertSame(item.progress, comps.last())
        assertTrue(comps.indexOf(qv) < comps.indexOf(item.progress))
    }

    fun `test active permission replaces active question`() {
        val item = panelWithPrompts()
        model.setState(SessionState.AwaitingQuestion(question()))
        model.setState(SessionState.AwaitingPermission(permission()))

        val qv = find<QuestionView>(item)!!
        val pv = find<PermissionView>(item)!!
        val comps = item.components.toList()

        assertFalse(qv.isVisible)
        assertTrue(pv.isVisible)
        assertSame(item.progress, comps.last())
    }

    fun `test idle hides active prompt and keeps progress footer last`() {
        val item = panelWithPrompts()
        model.setState(SessionState.AwaitingQuestion(question()))
        model.setState(SessionState.Idle)

        val qv = find<QuestionView>(item)!!
        val pv = find<PermissionView>(item)!!

        assertFalse(qv.isVisible)
        assertFalse(pv.isVisible)
        assertSame(item.progress, item.components.last())
    }

    fun `test cleared hides active prompt`() {
        val item = panelWithPrompts()
        model.setState(SessionState.AwaitingPermission(permission()))
        model.clear()

        val pv = find<PermissionView>(item)!!

        assertFalse(pv.isVisible)
        assertSame(item.progress, item.components.last())
    }

    fun `test login required state makes LoginRequiredView visible and hides others`() {
        val item = panelWithPrompts()
        model.setState(SessionState.LoginRequired("Sign in required."))

        val lv = find<LoginRequiredView>(item)!!
        val qv = find<QuestionView>(item)!!
        val pv = find<PermissionView>(item)!!

        assertTrue(lv.isVisible)
        assertFalse(qv.isVisible)
        assertFalse(pv.isVisible)
        assertSame(item.progress, item.components.last())
    }

    fun `test login required is anchored before progress footer`() {
        val item = panelWithPrompts()
        model.setState(SessionState.LoginRequired("Sign in required."))

        val lv = find<LoginRequiredView>(item)!!
        val comps = item.components.toList()

        assertTrue(comps.indexOf(lv) < comps.indexOf(item.progress))
        assertSame(item.progress, comps.last())
    }

    fun `test returning to idle hides login required view`() {
        val item = panelWithPrompts()
        model.setState(SessionState.LoginRequired("Sign in required."))
        model.setState(SessionState.Idle)

        val lv = find<LoginRequiredView>(item)!!

        assertFalse(lv.isVisible)
        assertSame(item.progress, item.components.last())
    }

    fun `test login required button invokes openProfile callback`() {
        var called = false
        val lv = LoginRequiredView(openProfile = { called = true }, dismiss = {})
        lv.show("Sign in required.")

        lv.openProfileButton().doClick()

        assertTrue(called)
    }

    fun `test rollback banner is anchored inside transcript before progress footer`() {
        val banner = RevertBanner(model, {}, {})
        val item = SessionMessageListPanel(model, parent, openFile = openFile, banner = banner)
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        model.setRevert(SessionRevertDto("u1"))

        val comps = item.components.toList()
        val turn = comps.first { it is TurnView }

        assertTrue(banner.isVisible)
        assertTrue(comps.indexOf(turn) < comps.indexOf(banner))
        assertTrue(comps.indexOf(banner) < comps.indexOf(item.progress))
        assertSame(item.progress, comps.last())
    }

    fun `test rollback banner uses session dialog card with standard actions`() {
        val banner = RevertBanner(model, {}, {})
        model.upsertMessage(msg("u1", "user"))
        model.setRevert(SessionRevertDto("u1"))
        banner.update()

        assertNotNull(find<BaseQuestionView>(banner))

        val buttons = components(banner).filterIsInstance<JButton>()
        assertEquals(
            listOf(KiloBundle.message("revert.banner.redo"), KiloBundle.message("revert.banner.redo.all")),
            buttons.map { it.text },
        )
        assertEquals(listOf(KiloBundle.message("revert.banner.redo")), buttons.filter { it.isVisible }.map { it.text })
        assertTrue(buttons.all { it.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY) == null })

        val hint = components(banner)
            .filterIsInstance<JBLabel>()
            .first { it.text == KiloBundle.message("revert.banner.hint") }
        assertEquals(UIUtil.getLabelForeground().rgb, hint.foreground.rgb)
    }

    fun `test rollback banner reuses file rows across updates`() {
        val banner = RevertBanner(model, {}, {})
        model.upsertMessage(msg("u1", "user"))
        model.setRevert(SessionRevertDto("u1"))
        model.setDiff(listOf(DiffFileDto("src/A.kt", 1, 0), DiffFileDto("src/B.kt", 2, 1)))
        banner.update()
        val rows = components(banner).filterIsInstance<Stack>().filter { stack ->
            stack.components.any { it is DiffStatBadge }
        }
        val count = components(banner).filterIsInstance<DiffStatBadge>().size

        model.setDiff(listOf(DiffFileDto("src/B.kt", 4, 2), DiffFileDto("src/A.kt", 3, 2)))
        banner.update()
        val next = components(banner).filterIsInstance<Stack>().filter { stack ->
            stack.components.any { it is DiffStatBadge }
        }

        assertSame(rows[1], next[0])
        assertSame(rows[0], next[1])
        assertEquals(count, components(banner).filterIsInstance<DiffStatBadge>().size)
        val badges = components(banner).filterIsInstance<DiffStatBadge>()
        assertEquals("+4", badges[0].addedLabelForTest().text)
        assertEquals("-2", badges[0].removedLabelForTest().text)
        assertEquals("+3", badges[1].addedLabelForTest().text)
        assertEquals("-2", badges[1].removedLabelForTest().text)
    }

    fun `test rollback banner shows redo all only for multiple reverted messages`() {
        val banner = RevertBanner(model, {}, {})
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.setRevert(SessionRevertDto("u1"))
        banner.update()

        assertTrue(components(banner).filterIsInstance<JButton>().first { it.text == KiloBundle.message("revert.banner.redo.all") }.isVisible)

        model.setRevert(SessionRevertDto("u2"))
        banner.update()

        assertFalse(components(banner).filterIsInstance<JButton>().first { it.text == KiloBundle.message("revert.banner.redo.all") }.isVisible)
    }

    fun `test rollback banner buttons invoke actions`() {
        var redo = 0
        var all = 0
        val banner = RevertBanner(model, { redo++ }, { all++ })
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.setRevert(SessionRevertDto("u1"))
        banner.update()

        components(banner).filterIsInstance<JButton>().first { it.text == KiloBundle.message("revert.banner.redo") }.doClick()
        components(banner).filterIsInstance<JButton>().first { it.text == KiloBundle.message("revert.banner.redo.all") }.doClick()

        assertEquals(1, redo)
        assertEquals(1, all)
    }

    fun `test rollback banner explains snapshotless history only revert`() {
        val banner = RevertBanner(model, {}, {})
        model.upsertMessage(msg("u1", "user"))
        model.setRevert(SessionRevertDto("u1", snapshot = null))
        banner.update()

        val notice = components(banner).filterIsInstance<JBLabel>()
            .first { it.text == KiloBundle.message("revert.banner.filesNotRestored") }

        assertTrue(notice.isVisible)
        assertTrue(components(banner).filterIsInstance<DiffStatBadge>().isEmpty())
    }

    fun `test rollback banner hides snapshotless notice when snapshot exists`() {
        val banner = RevertBanner(model, {}, {})
        model.upsertMessage(msg("u1", "user"))
        model.setRevert(SessionRevertDto("u1", snapshot = "snap1"))
        banner.update()

        val notice = components(banner).filterIsInstance<JBLabel>()
            .first { it.text == KiloBundle.message("revert.banner.filesNotRestored") }

        assertFalse(notice.isVisible)
    }

    // ------ question tool suppression ------

    fun `test active linked question hides matching running question tool`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("tp1", "a1", "question", "call1", state = "running"))

        val mv = item.findMessage("a1")!!
        assertEquals(listOf("tp1"), mv.partIds())

        model.setState(SessionState.AwaitingQuestion(question(tool = ToolCallRef("a1", "call1"))))

        assertTrue(mv.partIds().isEmpty())
    }

    fun `test clearing active question restores hidden question tool`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("tp1", "a1", "question", "call1", state = "running"))

        model.setState(SessionState.AwaitingQuestion(question(tool = ToolCallRef("a1", "call1"))))
        val mv = item.findMessage("a1")!!
        assertTrue(mv.partIds().isEmpty())

        model.setState(SessionState.Idle)

        assertEquals(listOf("tp1"), mv.partIds())
    }

    fun `test active question does not hide unrelated question tool`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        // tool part with a different callId
        model.updateContent("a1", toolPart("tp1", "a1", "question", "other-call", state = "running"))

        model.setState(SessionState.AwaitingQuestion(question(tool = ToolCallRef("a1", "call1"))))

        val mv = item.findMessage("a1")!!
        assertEquals(listOf("tp1"), mv.partIds())
    }

    fun `test completed question tool remains visible while question active`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        // completed state — must NOT be suppressed even when callId matches
        // No structured input/metadata so it renders as ToolView
        model.updateContent("a1", toolPart("tp1", "a1", "question", "call1", state = "completed"))

        model.setState(SessionState.AwaitingQuestion(question(tool = ToolCallRef("a1", "call1"))))

        val mv = item.findMessage("a1")!!
        assertEquals(listOf("tp1"), mv.partIds())
        assertTrue(mv.part("tp1") is ToolView)
    }

    fun `test todo tools are suppressed until todowrite completes`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("read", "a1", "todoread", "call1", state = "completed"))
        model.updateContent("a1", toolPart("write", "a1", "todowrite", "call2", state = "running"))

        val mv = item.findMessage("a1")!!
        assertEquals(emptyList<String>(), mv.partIds())

        model.updateContent(
            "a1",
            toolPart(
                "write", "a1", "todowrite", "call2", state = "completed",
                todos = listOf(TodoDto("Done", "completed", "high")),
            ),
        )

        assertEquals(listOf("write"), mv.partIds())
        assertTrue(mv.part("write") is TodoWriteView)
    }

    fun `test completed question update replaces generic tool view with question result view`() {
        val item = panelWithPrompts()
        model.upsertMessage(msg("a1", "assistant"))
        // Running question tool — no structured data yet, renders as ToolView
        model.updateContent("a1", toolPart("tp1", "a1", "question", "call1", state = "running"))

        val mv = item.findMessage("a1")!!
        assertTrue("Running question tool should be ToolView", mv.part("tp1") is ToolView)

        // Complete with structured data — should replace ToolView with QuestionResultView
        model.updateContent(
            "a1",
            toolPart(
                "tp1", "a1", "question", "call1", state = "completed",
                input = mapOf("questions" to """[{"question":"Which strategy?"},{"question":"Which checks?"}]"""),
                metadata = mapOf("answers" to """[["Comprehensive"],["Build"]]"""),
            ),
        )

        assertTrue("Completed question with data should be QuestionResultView", mv.part("tp1") is QuestionResultView)
        assertEquals(listOf("tp1"), mv.partIds())
    }

    fun `test completed plan update replaces tool view and keeps open file action`() {
        val opened = mutableListOf<String>()
        val item = SessionMessageListPanel(model, parent, openFile = { href, _ -> opened.add(href) })
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("tp1", "a1", "plan_exit", "call1", state = "running"))

        val mv = item.findMessage("a1")!!
        assertTrue(mv.part("tp1") is ToolView)

        model.updateContent(
            "a1",
            toolPart(
                "tp1", "a1", "plan_exit", "call1", state = "completed",
                metadata = mapOf("plan" to ".kilo/plans/x.md"),
            ),
        )

        val view = mv.part("tp1") as PlanExitView
        view.simulateLink(".kilo/plans/x.md")

        assertEquals(listOf(".kilo/plans/x.md"), opened)
    }

    fun `test entering a second hoverable part clears stale first hover`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent(
            "a1",
            toolPart(
                "tp1", "a1", "question", "call1", state = "completed",
                input = mapOf("questions" to """[{"question":"First?"}]"""),
                metadata = mapOf("answers" to """[["Yes"]]"""),
            ),
        )
        model.updateContent(
            "a1",
            toolPart(
                "tp2", "a1", "question", "call2", state = "completed",
                input = mapOf("questions" to """[{"question":"Second?"}]"""),
                metadata = mapOf("answers" to """[["No"]]"""),
            ),
        )
        val first = panel.findMessage("a1")!!.part("tp1") as QuestionResultView
        val second = panel.findMessage("a1")!!.part("tp2") as QuestionResultView
        val firstRoot = root(first)
        val secondRoot = root(second)

        first.toggle()
        second.toggle()

        enter(header(first))
        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, header(first).background.rgb)
        assertLine(firstRoot.border)

        enter(header(second))

        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, header(first).background.rgb)
        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, header(second).background.rgb)
        assertLine(firstRoot.border)
        assertLine(secondRoot.border)
    }

    // ------ helpers ------

    private fun panelWithPrompts(): SessionMessageListPanel {
        val q = QuestionView(
            project = project,
            reply = { _, _, _ -> },
            reject = { _ -> },
        )
        val p = PermissionView(
            reply = { _, _ -> },
        )
        val l = LoginRequiredView(openProfile = {}, dismiss = {})
        return SessionMessageListPanel(model, parent, q, p, l, openFile)
    }

    private inline fun <reified T> find(root: Container): T? = findCls(root, T::class.java)

    private fun <T> findCls(root: Container, cls: Class<T>): T? {
        if (cls.isInstance(root)) return cls.cast(root)
        for (child in root.components) {
            if (cls.isInstance(child)) return cls.cast(child)
            if (child is Container) {
                val item = findCls(child, cls)
                if (item != null) return item
            }
        }
        return null
    }

    private fun question(id: String = "q1", tool: ToolCallRef? = null) = Question(
        id = id,
        tool = tool,
        items = listOf(
            QuestionItem(
                question = "Proceed?",
                header = "Confirm",
                options = listOf(QuestionOption("Yes", "Continue")),
                multiple = false,
                custom = true,
            ),
        ),
    )

    private fun permission(id: String = "p1") = Permission(
        id = id,
        sessionId = "ses",
        name = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        meta = PermissionMeta(),
    )

    private fun msg(id: String, role: String) = MessageDto(
        id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0),
    )

    private fun part(id: String, mid: String, type: String, text: String? = null) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = type, text = text,
    )

    private fun toolPart(
        id: String,
        mid: String,
        tool: String,
        callId: String,
        state: String = "running",
        input: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap(),
        todos: List<TodoDto> = emptyList(),
    ) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = "tool", tool = tool, callID = callId, state = state,
        input = input, metadata = metadata, todos = todos,
    )

    private fun childTool(id: String, tool: String) = PartDto(
        id = id,
        sessionID = "ses_child",
        messageID = "child_msg",
        type = "tool",
        tool = tool,
        state = "completed",
        input = mapOf("filePath" to "src/Main.kt", "pattern" to "query"),
    )

    private fun root(view: QuestionResultView) = view.components[0] as JPanel

    private fun header(view: QuestionResultView) = root(view).components[0] as JPanel

    private fun enter(component: Component) {
        component.dispatchEvent(MouseEvent(
            component,
            MouseEvent.MOUSE_ENTERED,
            System.currentTimeMillis(),
            0,
            1,
            1,
            0,
            false,
        ))
    }

    private fun assertLine(border: Border) {
        val image = BufferedImage(5, 5, BufferedImage.TYPE_INT_ARGB)
        val item = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(item, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        val rgb = SessionUiStyle.View.Outline.brightColor().rgb
        assertEquals(rgb, Color(image.getRGB(2, 0), true).rgb)
        assertEquals(rgb, Color(image.getRGB(0, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(4, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(2, 4), true).rgb)
    }

    private fun count(root: Component): Int {
        if (root !is Container) return 1
        return 1 + root.components.sumOf(::count)
    }

    private fun layout(root: Container) {
        root.doLayout()
        for (child in root.components) if (child is Container) layout(child)
    }

    private fun promptBox(root: MessageView): Component {
        return components(root).first { it.parent != root && it is JPanel && it.componentCount == 1 && it.components.single() is TextView }
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(node: Component) {
            out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun taskText(view: TaskToolView): List<String> {
        val scroll = components(view).filterIsInstance<JBScrollPane>().single()
        val stack = components(scroll.viewport.view).filterIsInstance<Stack>().single()
        return stack.components.map { row ->
            components(row).filterIsInstance<JBLabel>()
                .mapNotNull { label -> label.text.takeIf { it.isNotBlank() } }
                .joinToString(" ")
        }
    }
}
