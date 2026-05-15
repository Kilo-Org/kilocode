package ai.kilocode.client.session

import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.EmptySessionPanel
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.PermissionPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.QuestionPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.rpc.dto.MessageWithPartsDto
import com.intellij.ui.components.JBScrollPane
import javax.swing.JLayeredPane

@Suppress("UnstableApiUsage")
class SessionUiLayoutTest : SessionUiTestBase() {

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

    fun `test header is docked above shared scroll pane and hidden while empty`() {
        val root = find<SessionRootPanel>(ui)
        val header = find<SessionHeaderPanel>(ui)
        val scroll = find<JBScrollPane>(ui)

        assertSame(root.content, header.parent.parent)
        assertSame(scroll.parent, header.parent)
        assertTrue(header.y <= scroll.y)
        assertFalse(header.isVisible)
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
        val pane = scrollComponent()
        val empty = find<EmptySessionPanel>(ui).view

        assertSame(empty, scrollView())

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().prompt("hello")
        }
        layout()

        assertSame(pane, find<SessionMessageListPanel>(ui).parent.parent)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test new session starts neutral before controller view state`() {
        ui = newUi(displayMs = 1_000)

        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is LoadingPanel)
    }

    fun `test action-created new session starts blank`() {
        ui = newUi(displayMs = 1_000)

        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is SessionMessageListPanel)
        assertFalse(scrollView() is LoadingPanel)
    }

    fun `test existing session id shows loading body immediately`() {
        rpc.historyGate = kotlinx.coroutines.CompletableDeferred()

        ui = newUi(id = "ses_test", displayMs = 1_000)

        assertSame(find<LoadingPanel>(ui), scrollView())
        assertEquals(SessionState.Loading, controller().model.state)
        rpc.historyGate?.complete(Unit)
    }

    fun `test clicking recent session calls opener via SessionRef`() {
        val opened = mutableListOf<String>()
        rpc.recent.add(session("ses_1"))
        ui = newUi(open = { ref -> if (ref is SessionRef.Local) opened.add(ref.id) })

        settle()
        layout()
        find<EmptySessionPanel>(ui).clickRecent(0)

        assertEquals(listOf("ses_1"), opened)
    }

    fun `test existing session id loads history and shows message body`() {
        rpc.history.addAll(history(1))

        ui = newUi(id = "ses_test")
        settle()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test empty explicit session id shows message body`() {
        rpc.recent.add(session("ses_recent"))
        settle()
        rpc.recentCalls.clear()

        ui = newUi(id = "ses_test")
        settle()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
        assertNull(find(ui, EmptySessionPanel::class.java))
        assertTrue(rpc.recentCalls.isEmpty())
    }

    fun `test explicit session id loading does not show recents`() {
        rpc.historyGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_recent"))
        settle()
        rpc.recentCalls.clear()

        ui = newUi(id = "ses_test", displayMs = 50)
        settleShort(100)

        assertSame(find<LoadingPanel>(ui), scrollView())
        assertNull(find(ui, EmptySessionPanel::class.java))
        assertTrue(rpc.recentCalls.isEmpty())

        rpc.historyGate!!.complete(Unit)
        settle()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
        assertTrue(rpc.recentCalls.isEmpty())
    }

    fun `test explicit cloud session loading does not show recents`() {
        rpc.importedCloudSession = session("ses_imported")
        rpc.historyGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_recent"))
        settle()
        rpc.recentCalls.clear()

        ui = newUi(id = "cloud:cloud_1", displayMs = 50)
        settleShort(100)

        assertSame(find<LoadingPanel>(ui), scrollView())
        assertNull(find(ui, EmptySessionPanel::class.java))
        assertTrue(rpc.recentCalls.isEmpty())

        rpc.historyGate!!.complete(Unit)
        settle()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
        assertTrue(rpc.recentCalls.isEmpty())
    }

    fun `test existing session history shows header above scroll pane`() {
        rpc.history.add(MessageWithPartsDto(message("msg1"), emptyList()))

        ui = SessionUi(project, workspace, sessions, app, scope, ref = SessionRef.Local("ses_test"), displayMs = 0).apply {
            setSize(800, 600)
        }
        settle()
        layout()

        val header = find<SessionHeaderPanel>(ui)
        val scroll = find<JBScrollPane>(ui)
        assertTrue(header.isVisible)
        assertTrue(header.y + header.height <= scroll.y)
    }

    fun `test new session shows blank body while recents are loading`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        ui = newUi(displayMs = 1_000)

        settleShort(100)

        // A new session (no id) shows blank body while recents are pending, not loading body
        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is LoadingPanel)
        rpc.recentGate!!.complete(Unit)
    }

    fun `test slow recents never show loading body and show recents when complete`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 50)

        settleShort(20)
        // No loading body — recents do not trigger progress indicator
        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is LoadingPanel)

        settleShort(80)
        // Still no loading body even after the delay interval passes
        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is LoadingPanel)

        rpc.recentGate!!.complete(Unit)
        settle()

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel.view, scrollView())
        assertEquals(1, panel.recentCount())
    }

    private fun showConnection() {
        find<ConnectionPanel>(ui).onEvent(SessionControllerEvent.ConnectionChanged.ShowConnecting)
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
}
