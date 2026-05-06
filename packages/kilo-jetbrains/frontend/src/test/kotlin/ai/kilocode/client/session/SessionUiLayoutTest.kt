package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.EmptySessionPanel
import ai.kilocode.client.session.ui.PermissionPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.QuestionPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.ChatEventDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import com.intellij.ui.components.JBScrollPane
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import javax.swing.JButton
import javax.swing.JScrollBar
import javax.swing.JLayeredPane

@Suppress("UnstableApiUsage")
class SessionUiLayoutTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var sessions: KiloSessionService
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var workspace: Workspace
    private lateinit var ui: SessionUi

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())

        rpc = FakeSessionRpcApi()
        val appRpc = FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        }
        val workspaceRpc = FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        }

        sessions = KiloSessionService(project, scope, rpc)
        app = KiloAppService(scope, appRpc)
        workspaces = KiloWorkspaceService(scope, workspaceRpc)
        workspace = workspaces.workspace("/test")

        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 0).apply {
            setSize(800, 600)
        }
        layout()
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test root contains content and overlay layers`() {
        val root = find<SessionRootPanel>(ui)

        assertEquals(2, root.componentCount)
        assertSame(root.content, root.components.first { it === root.content })
        assertSame(root.overlay, root.components.first { it === root.overlay })
        assertEquals(JLayeredPane.DEFAULT_LAYER, root.getLayer(root.content))
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
    }

    fun `test connection panel is docked between permission and prompt`() {
        val root = find<SessionRootPanel>(ui)
        val question = find<QuestionPanel>(ui)
        val permission = find<PermissionPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val stack = prompt.parent

        assertSame(root.content, stack.parent)
        assertSame(stack, connection.parent)
        assertEquals(1, root.overlay.componentCount)
        assertEquals(listOf(question, permission, connection, prompt), stack.components.toList())
    }

    fun `test default focused component is prompt editor`() {
        val prompt = find<PromptPanel>(ui)

        assertSame(prompt.defaultFocusedComponent, ui.defaultFocusedComponent)
    }

    fun `test connection panel uses stack width and sits above prompt`() {
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val stack = prompt.parent

        showConnection()
        layout()

        assertTrue(connection.isVisible)
        assertEquals(0, connection.x)
        assertEquals(stack.width, connection.width)
        assertEquals(prompt.width, connection.width)
        assertTrue(connection.y + connection.height <= prompt.y)
    }

    fun `test connection panel moves after visible question panel`() {
        val connection = find<ConnectionPanel>(ui)
        val question = find<QuestionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        showConnection()
        layout()
        assertFalse(question.isVisible)
        val top = connection.y

        controller().model.setState(questionStateChanged())
        layout()

        assertTrue(question.isVisible)
        assertTrue(question.y < connection.y)
        assertTrue(top < connection.y)
        assertTrue(connection.y + connection.height <= prompt.y)
    }

    fun `test connection panel moves after visible permission panel`() {
        val connection = find<ConnectionPanel>(ui)
        val permission = find<PermissionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        showConnection()
        layout()
        assertFalse(permission.isVisible)
        val top = connection.y

        controller().model.setState(permissionStateChanged())
        layout()

        assertTrue(permission.isVisible)
        assertTrue(permission.y < connection.y)
        assertTrue(top < connection.y)
        assertTrue(connection.y + connection.height <= prompt.y)
    }

    fun `test empty and message bodies share the same scroll pane`() {
        settle()
        val scroll = find<JBScrollPane>(ui)
        val empty = find<EmptySessionPanel>(ui)

        assertSame(empty, scroll.viewport.view)

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().prompt("hello")
        }
        layout()

        assertSame(scroll, find<SessionMessageListPanel>(ui).parent.parent)
        assertSame(find<SessionMessageListPanel>(ui), scroll.viewport.view)
    }

    fun `test new session starts with loading body`() {
        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 1_000).apply {
            setSize(800, 600)
        }

        assertFalse(find<JBScrollPane>(ui).viewport.view is EmptySessionPanel)
    }

    fun `test action-created new session starts blank`() {
        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 1_000, loading = false).apply {
            setSize(800, 600)
        }

        assertFalse(find<JBScrollPane>(ui).viewport.view is EmptySessionPanel)
        assertFalse(find<JBScrollPane>(ui).viewport.view is SessionMessageListPanel)
    }

    fun `test clicking recent session calls opener`() {
        val opened = mutableListOf<String>()
        rpc.recent.add(session("ses_1"))
        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 0, open = { opened.add(it.id) }).apply {
            setSize(800, 600)
        }

        settle()
        layout()
        find<EmptySessionPanel>(ui).clickRecent(0)

        assertEquals(listOf("ses_1"), opened)
    }

    fun `test existing session id loads history and shows message body`() {
        rpc.history.add(MessageWithPartsDto(message("msg1"), emptyList()))

        ui = SessionUi(project, workspace, sessions, app, scope, id = "ses_test", displayMs = 0).apply {
            setSize(800, 600)
        }
        settle()

        assertSame(find<SessionMessageListPanel>(ui), find<JBScrollPane>(ui).viewport.view)
    }

    fun `test new session keeps loading body before recents delay`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 1_000).apply {
            setSize(800, 600)
        }

        settleShort(100)

        assertFalse(find<JBScrollPane>(ui).viewport.view is EmptySessionPanel)
    }

    fun `test slow recents switch to loading body only after progress event`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_1"))
        ui = SessionUi(project, workspace, sessions, app, scope, displayMs = 50).apply {
            setSize(800, 600)
        }

        settleShort(20)
        assertFalse(find<JBScrollPane>(ui).viewport.view is EmptySessionPanel)

        settleShort(80)
        assertFalse(find<JBScrollPane>(ui).viewport.view is EmptySessionPanel)

        rpc.recentGate!!.complete(Unit)
        settle()

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel, find<JBScrollPane>(ui).viewport.view)
        assertEquals(1, panel.recentCount())
    }

    fun `test session update follows when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test session update follows when transcript is near bottom threshold`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val threshold = JBUI.scale(32)
        if (bottom(bar) <= threshold) {
            fillTranscript(24, start = 24)
        }
        setValue(bar, bottom(bar) - threshold + 1)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test session update preserves position outside bottom threshold`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val threshold = JBUI.scale(32)
        setValue(bar, bottom(bar) - threshold - 8)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test session update preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test user scroll between updates disables following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail1")))
        drainScroll()
        assertBottom(bar)

        setValue(bar, bottom(bar) / 2)
        val value = bar.value
        emit(ChatEventDto.MessageUpdated("ses_test", message("tail2")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test user returning to bottom between updates resumes following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail1")))
        drainScroll()
        assertEquals(value, bar.value)

        setBottom(bar)
        emit(ChatEventDto.MessageUpdated("ses_test", message("tail2")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test batched update samples scroll once before model changes`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("batch")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("part", "batch", "text", "hello")), flush = false)
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test state changes do not force scroll when user is in middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.TurnOpen("ses_test"))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test scroll button appears only when transcript is away from bottom`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()

        setBottom(bar)
        drainScroll()
        assertFalse(button.isVisible)

        setValue(bar, bottom(bar) / 2)
        drainScroll()
        assertTrue(button.isVisible)

        setBottom(bar)
        drainScroll()
        assertFalse(button.isVisible)
    }

    fun `test scroll button scrolls transcript to bottom`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        drainScroll()
        assertTrue(button.isVisible)

        button.doClick()
        drainScroll()

        assertBottom(bar)
        assertFalse(button.isVisible)
    }

    fun `test scroll button remains hidden outside transcript body`() {
        val button = jumpButton()

        settle()
        layout()

        assertFalse(button.isVisible)
    }

    fun `test history load follows initially empty transcript`() {
        rpc.history.addAll(history(24))
        ui = SessionUi(project, workspace, sessions, app, scope, id = "ses_test", displayMs = 0).apply {
            setSize(800, 600)
        }
        settle()
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test recovered state after history preserves user scroll position`() {
        rpc.history.addAll(history(24))
        rpc.statuses.value = mapOf("ses_test" to ai.kilocode.rpc.dto.SessionStatusDto("busy"))
        ui = SessionUi(project, workspace, sessions, app, scope, id = "ses_test", displayMs = 0).apply {
            setSize(800, 600)
        }
        settle()
        drainScroll()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.TurnOpen("ses_test"))
        drainScroll()

        assertEquals(value, bar.value)
    }

    private fun layout() {
        ui.doLayout()
        val root = find<SessionRootPanel>(ui)
        root.doLayout()
        root.content.doLayout()
        find<PromptPanel>(ui).parent.doLayout()
        find<JBScrollPane>(ui).doLayout()
        (find<JBScrollPane>(ui).viewport.view as? java.awt.Container)?.doLayout()
    }

    private fun settle() = runBlocking {
        repeat(5) {
            delay(100)
            com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun settleShort(ms: Long) = runBlocking {
        delay(ms)
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
    }

    private fun showConnection() {
        find<ConnectionPanel>(ui).onEvent(SessionControllerEvent.ConnectionChanged.ShowConnecting)
    }

    private fun showMessages() {
        controller().prompt("hello")
        settle()
        layout()
    }

    private fun fillTranscript(count: Int, start: Int = 0) {
        repeat(count) { offset ->
            val i = start + offset
            val id = "msg_$i"
            emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
            emit(ChatEventDto.PartUpdated("ses_test", part("part_$i", id, "text", text(i))), flush = false)
        }
        settleShort(100)
        forceFlush()
        drainScroll()
    }

    private fun emit(event: ChatEventDto, flush: Boolean = true) {
        runBlocking { rpc.events.emit(event) }
        if (flush) {
            settleShort(20)
            forceFlush()
        }
    }

    private fun forceFlush() {
        controller().flushEvents()
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
    }

    private fun drainScroll() {
        repeat(4) {
            layout()
            com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun scrollBar(): JScrollBar = find<JBScrollPane>(ui).verticalScrollBar

    private fun jumpButton(): JButton {
        return find<SessionRootPanel>(ui).overlay.components.single() as JButton
    }

    private fun bottom(bar: JScrollBar): Int = (bar.maximum - bar.visibleAmount).coerceAtLeast(0)

    private fun setBottom(bar: JScrollBar) {
        setValue(bar, bottom(bar))
    }

    private fun setValue(bar: JScrollBar, value: Int) {
        bar.value = value.coerceIn(bar.minimum, bottom(bar))
    }

    private fun assertBottom(bar: JScrollBar) {
        assertTrue("value=${bar.value} bottom=${bottom(bar)} max=${bar.maximum} visible=${bar.visibleAmount}", bar.value >= bottom(bar) - 1)
    }

    private inline fun <reified T> find(root: java.awt.Container): T {
        return find(root, T::class.java) ?: error("missing ${T::class.java.simpleName}")
    }

    private fun <T> find(root: java.awt.Container, cls: Class<T>): T? {
        if (cls.isInstance(root)) return cls.cast(root)
        for (child in root.components) {
            if (cls.isInstance(child)) return cls.cast(child)
            if (child is java.awt.Container) {
                val item = find(child, cls)
                if (item != null) return item
            }
        }
        return null
    }

    private fun controller(): SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(ui) as SessionController
    }

    private fun questionStateChanged() = SessionState.AwaitingQuestion(
        Question(
            id = "q1",
            items = listOf(
                QuestionItem(
                    question = "Proceed?",
                    header = "Confirm",
                    options = listOf(QuestionOption("Yes", "Continue")),
                    multiple = false,
                    custom = true,
                )
            ),
        )
    )

    private fun permissionStateChanged() = SessionState.AwaitingPermission(
        Permission(
            id = "p1",
            sessionId = "ses",
            name = "edit",
            patterns = listOf("*.kt"),
            always = emptyList(),
            meta = PermissionMeta(raw = emptyMap()),
        )
    )

    private fun session(id: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = "Recent $id",
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private fun message(id: String) = MessageDto(
        id = id,
        sessionID = "ses_test",
        role = "user",
        time = MessageTimeDto(created = 0.0),
    )

    private fun part(id: String, mid: String, type: String, text: String? = null) = PartDto(
        id = id,
        sessionID = "ses_test",
        messageID = mid,
        type = type,
        text = text,
    )

    private fun history(count: Int): List<MessageWithPartsDto> = List(count) { i ->
        val id = "hist_$i"
        MessageWithPartsDto(message(id), listOf(part("hist_part_$i", id, "text", text(i))))
    }

    private fun text(i: Int): String = "line $i\n".repeat(12)
}
