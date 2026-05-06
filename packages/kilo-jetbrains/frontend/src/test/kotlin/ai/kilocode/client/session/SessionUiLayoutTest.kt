package ai.kilocode.client.session

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
import ai.kilocode.client.session.update.SessionControllerEvent
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
        val empty = find<EmptySessionPanel>(ui)

        assertSame(empty, scrollView())

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().prompt("hello")
        }
        layout()

        assertSame(pane, find<SessionMessageListPanel>(ui).parent.parent)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test new session starts with loading body`() {
        ui = newUi(displayMs = 1_000)

        assertFalse(scrollView() is EmptySessionPanel)
    }

    fun `test action-created new session starts blank`() {
        ui = newUi(displayMs = 1_000, loading = false)

        assertFalse(scrollView() is EmptySessionPanel)
        assertFalse(scrollView() is SessionMessageListPanel)
    }

    fun `test clicking recent session calls opener`() {
        val opened = mutableListOf<String>()
        rpc.recent.add(session("ses_1"))
        ui = newUi(open = { opened.add(it.id) })

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

    fun `test new session keeps loading body before recents delay`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        ui = newUi(displayMs = 1_000)

        settleShort(100)

        assertFalse(scrollView() is EmptySessionPanel)
    }

    fun `test slow recents switch to loading body only after progress event`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 50)

        settleShort(20)
        assertFalse(scrollView() is EmptySessionPanel)

        settleShort(80)
        assertFalse(scrollView() is EmptySessionPanel)

        rpc.recentGate!!.complete(Unit)
        settle()

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel, scrollView())
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
