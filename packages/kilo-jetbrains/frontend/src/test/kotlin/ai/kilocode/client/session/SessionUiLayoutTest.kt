package ai.kilocode.client.session

import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import com.intellij.util.ui.JBUI
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.rpc.dto.MessageWithPartsDto
import com.intellij.ui.components.JBScrollPane
import javax.swing.JLayeredPane

@Suppress("UnstableApiUsage")
class SessionUiLayoutTest : SessionUiTestBase() {

    fun `test root contains content overlay and blocker layers`() {
        val root = find<SessionRootPanel>(ui)

        assertEquals(3, root.componentCount)
        assertSame(root.content, root.components.first { it === root.content })
        assertSame(root.overlay, root.components.first { it === root.overlay })
        assertSame(root.blocker, root.components.first { it === root.blocker })
        assertEquals(JLayeredPane.DEFAULT_LAYER, root.getLayer(root.content))
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
        assertEquals(JLayeredPane.MODAL_LAYER, root.getLayer(root.blocker))
        assertFalse(root.blocker.isVisible)
    }

    fun `test session surfaces use session background from initial render`() {
        val bg = SessionEditorStyle.current().editorBackground
        val root = find<SessionRootPanel>(ui)
        val pane = scrollComponent() as JBScrollPane

        assertEquals(bg, ui.background)
        assertEquals(bg, root.content.background)
        assertEquals(bg, pane.background)
        assertEquals(bg, pane.viewport.background)

        showMessages()

        assertEquals(bg, find<SessionMessageListPanel>(ui).background)
    }

    fun `test prompt is docked and connection is overlaid`() {
        val root = find<SessionRootPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        assertSame(root.content, prompt.parent)
        assertSame(root.overlay, connection.parent)
        assertTrue(root.overlay.components.any { it is SessionAccountOverlay })
        assertFalse(root.content.components.contains(connection))
    }

    fun `test drop overlay is attached under root overlay layer`() {
        val root = find<SessionRootPanel>(ui)
        val drop = find<SessionDropOverlay>(ui)

        assertSame(root.overlay, drop.parent)
        assertTrue(drop.isVisible)
        assertFalse(drop.contains(1, 1))
        assertFalse(root.blocker.components.contains(drop))
    }

    fun `test drop overlay is visual only and not native file drop target`() {
        val drop = find<SessionDropOverlay>(ui)

        assertNull(drop.dropTarget)
    }

    fun `test prompt file drag leave does not immediately hide drop overlay`() {
        val prompt = find<PromptPanel>(ui)
        val drop = find<SessionDropOverlay>(ui)
        val card = dropCard(drop)

        layout()
        prompt.onFileDrag(true)
        assertFalse(drop.contains(1, 1))
        assertTrue(card.isVisible)

        prompt.onFileDrag(false)
        assertFalse(drop.contains(1, 1))
        assertTrue(card.isVisible)

        prompt.onFileDrag(true)
        drop.setActive(false)
    }

    fun `test drop overlay covers full session after layout`() {
        val root = find<SessionRootPanel>(ui)
        val drop = find<SessionDropOverlay>(ui)

        layout()

        assertEquals(java.awt.Rectangle(0, 0, root.overlay.width, root.overlay.height), drop.bounds)
    }

    fun `test drop overlay is above account and scroll overlays`() {
        val root = find<SessionRootPanel>(ui)
        val drop = find<SessionDropOverlay>(ui)
        val account = find<SessionAccountOverlay>(ui)
        val jump = jumpButton()

        assertTrue(root.overlay.getComponentZOrder(drop) < root.overlay.getComponentZOrder(account))
        assertTrue(root.overlay.getComponentZOrder(drop) < root.overlay.getComponentZOrder(jump))
    }

    fun `test active views are children of message list panel`() {
        ui = newUi(id = "ses_test")
        settle()

        val messages = find<SessionMessageListPanel>(ui)
        val qv = find<QuestionView>(ui)
        val pv = find<PermissionView>(ui)

        assertSame(messages, qv.parent)
        assertSame(messages, pv.parent)
    }

    fun `test header is docked above shared scroll pane and hidden while empty`() {
        val root = find<SessionRootPanel>(ui)
        val header = find<SessionHeaderPanel>(ui)
        // Search from root.content to avoid finding the migration wizard scroll panes
        val scroll = find<JBScrollPane>(root.content)

        assertSame(root.content, header.parent.parent)
        assertSame(scroll.parent, header.parent)
        assertTrue(header.y <= scroll.y)
        assertFalse(header.isVisible)
    }

    fun `test default focused component is prompt editor`() {
        val prompt = find<PromptPanel>(ui)

        assertSame(prompt.defaultFocusedComponent, ui.defaultFocusedComponent)
    }

    fun `test connection panel overlays above full prompt width`() {
        val root = find<SessionRootPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        showConnection()
        layout()

        assertTrue(connection.isVisible)
        assertSame(root.overlay, connection.parent)
        assertEquals(prompt.x, connection.x)
        assertEquals(prompt.width, connection.width)
        assertEquals(prompt.y - SessionUiStyle.View.Outline.width(), connection.y + connection.height)
    }

    fun `test expanded connection panel remains anchored above prompt`() {
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        connection.onEvent(SessionControllerEvent.ConnectionChanged.ShowError(
            "CLI startup failed",
            "line 1\nline 2",
        ))
        layout()
        connection.clickSummary()
        layout()

        assertTrue(connection.detailsVisible())
        assertEquals(prompt.y - SessionUiStyle.View.Outline.width(), connection.y + connection.height)
    }

    fun `test connection panel is unaffected by active question view`() {
        ui = newUi(id = "ses_test")
        settle()
        showConnection()
        layout()
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val top = connection.y

        controller().model.setState(questionStateChanged())
        layout()

        assertTrue(find<QuestionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<QuestionView>(ui).parent)
        assertEquals(top, connection.y)
        assertEquals(prompt.y - SessionUiStyle.View.Outline.width(), connection.y + connection.height)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test connection panel is unaffected by active permission view`() {
        ui = newUi(id = "ses_test")
        settle()
        showConnection()
        layout()
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val top = connection.y

        controller().model.setState(permissionStateChanged())
        layout()

        assertTrue(find<PermissionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<PermissionView>(ui).parent)
        assertEquals(top, connection.y)
        assertEquals(prompt.y - SessionUiStyle.View.Outline.width(), connection.y + connection.height)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test active question view renders inside message scroll view`() {
        ui = newUi(id = "ses_test")
        settle()

        controller().model.setState(questionStateChanged())
        layout()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
        assertTrue(find<QuestionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<QuestionView>(ui).parent)
        assertTrue(find<QuestionView>(ui).parent !== find<PromptPanel>(ui).parent)
    }

    fun `test active permission view renders inside message scroll view`() {
        ui = newUi(id = "ses_test")
        settle()

        controller().model.setState(permissionStateChanged())
        layout()

        assertSame(find<SessionMessageListPanel>(ui), scrollView())
        assertTrue(find<PermissionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<PermissionView>(ui).parent)
        assertTrue(find<PermissionView>(ui).parent !== find<PromptPanel>(ui).parent)
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

    fun `test retry status keeps transcript and shows message in footer`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        controller().model.setState(SessionState.Retry("The usage limit has been reached", attempt = 4, next = 0L))
        layout()

        val panel = find<SessionMessageListPanel>(ui)
        assertSame(panel, scrollView())
        assertTrue(panel.progress.isVisible)
        assertEquals("The usage limit has been reached (attempt 4)", panel.progress.labelText())

        controller().model.setState(SessionState.Idle)
        layout()

        assertSame(panel, scrollView())
        assertFalse(panel.progress.isVisible)
    }

    fun `test offline status keeps transcript and shows message in footer`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        controller().model.setState(SessionState.Offline("", requestId = "req1"))
        layout()

        val panel = find<SessionMessageListPanel>(ui)
        assertSame(panel, scrollView())
        assertTrue(panel.progress.isVisible)
        assertEquals("Connection offline", panel.progress.labelText())
    }

    fun `test busy progress footer uses transcript foreground`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        controller().model.setState(SessionState.Busy("Considering next steps..."))
        layout()

        val panel = find<SessionMessageListPanel>(ui)
        assertTrue(panel.progress.isVisible)
        assertEquals(SessionEditorStyle.current().editorForeground, panel.progress.labelForeground())
    }

    fun `test retry before transcript shows loading panel`() {
        ui = newUi(displayMs = 1_000)

        controller().model.setState(SessionState.Retry("The usage limit has been reached", attempt = 4, next = 0L))
        layout()

        assertSame(find<LoadingPanel>(ui), scrollView())
    }

    fun `test retry offline churn retains transcript panel and footer`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        val panel = find<SessionMessageListPanel>(ui)
        val progress = panel.progress
        val count = panel.componentCount

        repeat(100) { i ->
            controller().model.setState(SessionState.Retry("Rate limited", attempt = i + 1, next = 0L))
            layout()
            assertSame(panel, scrollView())
            assertSame(progress, panel.progress)
            assertEquals(count, panel.componentCount)
            assertTrue(panel.progress.isVisible)

            controller().model.setState(SessionState.Offline("Connection offline", requestId = "req$i"))
            layout()
            assertSame(panel, scrollView())
            assertSame(progress, panel.progress)
            assertEquals(count, panel.componentCount)
            assertTrue(panel.progress.isVisible)

            controller().model.setState(SessionState.Idle)
            layout()
            assertSame(panel, scrollView())
            assertSame(progress, panel.progress)
            assertEquals(count, panel.componentCount)
            assertFalse(panel.progress.isVisible)
        }
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

        ui = newUi(id = "ses_test")
        settle()
        layout()

        val root = find<SessionRootPanel>(ui)
        val header = find<SessionHeaderPanel>(ui)
        val scroll = find<JBScrollPane>(root.content)
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

    // --- account overlay layout tests ---

    fun `test account overlay is registered in root overlay layer`() {
        val root = find<SessionRootPanel>(ui)
        val overlay = find<SessionAccountOverlay>(ui)

        assertSame(root.overlay, overlay.parent)
    }

    fun `test account overlay hidden before recents complete`() {
        rpc.recentGate = kotlinx.coroutines.CompletableDeferred()
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 1_000)

        settleShort(100)

        val overlay = find<SessionAccountOverlay>(ui)
        assertFalse(overlay.isVisible)

        rpc.recentGate!!.complete(Unit)
    }

    fun `test account overlay shows after recents complete`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = ProfileDto(email = "user@example.com"))
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 1_000)

        settle()

        val overlay = find<SessionAccountOverlay>(ui)
        assertTrue(overlay.isVisible)
    }

    fun `test account overlay hides after first prompt`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = ProfileDto(email = "user@example.com"))
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 1_000)
        settle()

        val overlay = find<SessionAccountOverlay>(ui)
        assertTrue(overlay.isVisible)

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().prompt("hello")
        }
        settle()

        assertFalse(overlay.isVisible)
    }

    fun `test explicit session does not show overlay`() {
        ui = newUi(id = "ses_test")
        settle()

        val overlay = find<SessionAccountOverlay>(ui)
        assertFalse(overlay.isVisible)
    }

    fun `test account overlay uses prompt panel top and right insets`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = ProfileDto(email = "user@example.com"))
        rpc.recent.add(session("ses_1"))
        ui = newUi(displayMs = 1_000)
        settle()
        layout()

        val root = find<SessionRootPanel>(ui)
        val overlay = find<SessionAccountOverlay>(ui)
        val top = JBUI.scale(SessionUiStyle.View.Prompt.PANEL_VERTICAL_PADDING)
        val right = JBUI.scale(SessionUiStyle.View.Prompt.PANEL_HORIZONTAL_PADDING)

        assertTrue(overlay.isVisible)
        assertEquals(top, overlay.y)
        assertEquals(root.overlay.width - overlay.width - right, overlay.x)
    }

    private fun dropCard(drop: SessionDropOverlay) = drop.components
        .single()
        .let { it as javax.swing.JComponent }
        .components
        .single()
        .let { it as javax.swing.JComponent }
}
