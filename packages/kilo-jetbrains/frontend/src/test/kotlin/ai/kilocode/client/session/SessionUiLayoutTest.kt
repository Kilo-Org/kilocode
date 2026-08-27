package ai.kilocode.client.session

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
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
import ai.kilocode.client.session.ui.RevertProgress
import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionLayoutPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.header.BranchDock
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.ui.layout.Align
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.SessionRevertDto
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.util.ui.JBUI
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.rpc.dto.MessageWithPartsDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.JBScrollPane
import java.awt.Dimension
import javax.swing.JLayeredPane
import javax.swing.JPanel
import javax.swing.SwingUtilities
import kotlinx.coroutines.CompletableDeferred

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
        val bg = SessionUiStyle.Colors.sessionBackground()
        val root = find<SessionRootPanel>(ui)
        val pane = scrollComponent() as JBScrollPane

        // One opaque backdrop, self-rendered from the theme at first paint (no applyStyle push).
        assertTrue(root.isOpaque)
        assertEquals(bg, root.background)
        // Intermediate containers stay transparent over that single backdrop.
        assertFalse(root.content.isOpaque)
        assertFalse(pane.isOpaque)
        assertFalse(pane.viewport.isOpaque)

        showMessages()

        val messages = find<SessionMessageListPanel>(ui)
        assertFalse(messages.isOpaque)
        assertEquals(bg, root.background)
    }

    fun `test prompt is docked and connection is overlaid`() {
        val root = find<SessionRootPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        // Prompt sits inside an Align inside the bottom Stack container, which is docked SOUTH.
        assertTrue(prompt.parent is Align)
        assertSame(root.content, prompt.parent.parent.parent)
        assertSame(root.overlay, connection.parent)
        assertTrue(root.overlay.components.any { it is SessionAccountOverlay })
        assertFalse(root.content.components.contains(connection))
    }

    fun `test dock is docked between scroll pane and prompt`() {
        val prompt = find<PromptPanel>(ui)
        val dock = find<BranchDock>(ui)

        // Dock and the aligned prompt share the bottom container; the dock comes first (above prompt).
        val container = dock.parent
        assertSame(container, prompt.parent.parent)
        assertTrue(container.getComponentZOrder(dock) < container.getComponentZOrder(prompt.parent))
    }

    fun `test readonly session omits dock`() {
        val owner = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
            override val readonly: Boolean get() = true
        }
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test", manager = owner)
        settle()

        assertNull(find(ui, BranchDock::class.java))
    }

    fun `test dock absent when manager disables branch dock`() {
        val owner = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
            override val showsBranchDock: Boolean get() = false
        }
        ui = newUi(manager = owner)
        settle()

        assertNull(find(ui, BranchDock::class.java))
    }

    fun `test transcript uses larger standard gap before prompts after first item`() {
        val panel = SessionLayoutPanel(gap = SessionUiStyle.SessionLayout.GAP).apply {
            setSize(400, 300)
            add(Row(SessionView.Kind.UserPrompt))
            add(Row(SessionView.Kind.Default))
            add(Row(SessionView.Kind.UserPrompt))
        }

        panel.doLayout()

        assertEquals(0, panel.getComponent(0).y)
        assertEquals(SessionUiStyle.SessionLayout.GAP, panel.getComponent(1).y - panel.getComponent(0).bounds.maxY.toInt())
        assertEquals(
            JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_GAP),
            panel.getComponent(2).y - panel.getComponent(1).bounds.maxY.toInt(),
        )
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

    fun `test dock hides while a turn runs`() {
        val worktree = FakeWorktreeRpcApi().apply {
            branchResult = BranchStatusDto(branch = "main", availability = GhAvailability.OK)
        }
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(scope, worktree), testRootDisposable)
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        val dock = find<BranchDock>(ui)
        assertTrue(dock.isVisible)

        controller().model.setState(SessionState.Busy("running"))

        assertFalse(dock.isVisible)

        controller().model.setState(SessionState.Idle)
        settle()

        assertTrue(dock.isVisible)
    }

    fun `test dock move delegates to manager without progress state`() {
        val calls = mutableListOf<Pair<String?, String>>()
        val owner = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
            override val supportsMoveToWorktree: Boolean get() = true
            override fun moveToWorktree(sessionId: String?, directory: String) {
                calls += sessionId to directory
            }
        }
        val worktree = FakeWorktreeRpcApi().apply {
            branchResult = BranchStatusDto(branch = "main", availability = GhAvailability.OK)
        }
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(scope, worktree), testRootDisposable)
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test", manager = owner)
        settle()
        val dock = find<BranchDock>(ui)
        assertTrue(dock.isVisible)

        dock.triggerMove()

        assertEquals(listOf("ses_test" to "/test"), calls)
        assertTrue(dock.isVisible)
        assertTrue(dock.moveEnabled())
    }

    fun `test dock move forwards a null session for a new session with local changes`() {
        val calls = mutableListOf<Pair<String?, String>>()
        val owner = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
            override val supportsMoveToWorktree: Boolean get() = true
            override fun moveToWorktree(sessionId: String?, directory: String) {
                calls += sessionId to directory
            }
        }
        val worktree = FakeWorktreeRpcApi().apply {
            branchResult = BranchStatusDto(branch = "main", availability = GhAvailability.OK)
        }
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(scope, worktree), testRootDisposable)
        workspaceRpc.branchDiffs.add(DiffFileDto("src/A.kt", 2, 1))
        // A brand-new sidebar session has no id until its first prompt, but the local changes alone
        // are worth moving: the worktree gets the changes and starts its own session.
        ui = newUi(manager = owner)
        settle()
        val dock = find<BranchDock>(ui)

        assertTrue(dock.isVisible)
        assertTrue(dock.moveEnabled())

        dock.triggerMove()

        assertEquals(listOf<Pair<String?, String>>(null to "/test"), calls)
    }

    fun `test a failed branch status leaves the dock inactive instead of assuming healthy git`() {
        val worktree = FakeWorktreeRpcApi().apply { branchThrows = IllegalStateException("backend down") }
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(scope, worktree), testRootDisposable)
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        // An empty status DTO would default to GhAvailability.OK and offer worktree actions against
        // a directory whose git state is unknown, so a failure must leave the dock untouched.
        assertFalse(find<BranchDock>(ui).isVisible)
    }

    fun `test dock branch changes refresh on finish and revert`() {
        workspaceRpc.branchDiffs.clear()
        workspaceRpc.branchDiffs.add(DiffFileDto("src/A.kt", 2, 1))
        val badge = find<ai.kilocode.client.session.ui.header.BranchChangesBadge>(ui)

        controller().model.setState(SessionState.Busy("running"))
        controller().model.setState(SessionState.Idle)
        settle()

        assertEquals(2 to 1, badge.stats())

        workspaceRpc.branchDiffs.clear()
        workspaceRpc.branchDiffs.add(DiffFileDto("src/B.kt", 4, 3))
        controller().model.setState(SessionState.Busy("running"))
        controller().model.setState(SessionState.Idle)
        settle()

        assertEquals(4 to 3, badge.stats())

        workspaceRpc.branchDiffs.clear()
        workspaceRpc.branchDiffs.add(DiffFileDto("src/C.kt", 1, 0))
        controller().model.setRevert(SessionRevertDto("msg1", "part1", diff = "patch"))
        settle()

        assertEquals(1 to 0, badge.stats())
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
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()

        val messages = find<SessionMessageListPanel>(ui)
        val qv = find<QuestionView>(ui)
        val pv = find<PermissionView>(ui)

        assertSame(messages, qv.parent)
        assertSame(messages, pv.parent)
    }

    fun `test readonly session omits prompt and active reply views`() {
        val owner = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
            override val readonly: Boolean get() = true
        }
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test", manager = owner)
        settle()
        layoutReadonly()

        assertNull(find(ui, PromptPanel::class.java))
        assertNull(find(ui, QuestionView::class.java))
        assertNull(find(ui, PermissionView::class.java))
        assertSame(scrollComponent(), ui.defaultFocusedComponent)
        assertTrue(find<SessionMessageListPanel>(ui).parent != null)
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

    fun `test revert sync preserves active prompt draft`() {
        val prompt = find<PromptPanel>(ui)
        val model = controller().model
        val msg = message("u1")
        model.upsertMessage(msg)
        model.updateContent("u1", part("p1", "u1", "text", "rolled back prompt"))
        prompt.setText("unsent draft")

        model.setRevert(SessionRevertDto("u1"))

        assertEquals("unsent draft", prompt.text())
    }

    fun `test revert sync restores prompt when empty`() {
        val prompt = find<PromptPanel>(ui)
        val model = controller().model
        model.upsertMessage(message("u1"))
        model.updateContent("u1", part("p1", "u1", "text", "rolled back prompt"))

        model.setRevert(SessionRevertDto("u1"))

        assertEquals("rolled back prompt", prompt.text())
    }

    fun `test connection panel overlays above prompt with transparent inset`() {
        val root = find<SessionRootPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        showConnection()
        layout()
        val point = promptPoint(root, prompt)
        val gap = SessionUiStyle.View.contentGap()

        assertTrue(connection.isVisible)
        assertSame(root.overlay, connection.parent)
        assertEquals(point.x + gap, connection.x)
        assertEquals(prompt.width - gap * 2, connection.width)
        assertEquals(bottomTop(root, prompt) - gap, connection.y + connection.height)
    }

    fun `test expanded connection panel remains anchored above prompt`() {
        val root = find<SessionRootPanel>(ui)
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
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)
    }

    fun `test expanded connection panel is capped to transcript height`() {
        ui.setSize(800, 260)
        layout()
        val root = find<SessionRootPanel>(ui)
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)

        connection.onEvent(SessionControllerEvent.ConnectionChanged.ShowError(
            "CLI startup failed",
            lines(60),
        ))
        layout()
        connection.clickSummary()
        layout()
        val pane = connection.components.filterIsInstance<JBScrollPane>().single()
        pane.doLayout()

        assertTrue(connection.detailsVisible())
        assertEquals(0, connection.y)
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)
        assertTrue(pane.viewport.extentSize.height < pane.viewport.view.preferredSize.height)
    }

    fun `test connection panel is unaffected by active question view`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        showConnection()
        layout()
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val root = find<SessionRootPanel>(ui)
        // Anchored above the bottom container, not at a fixed y: a pending question makes the branch
        // dock release its row, so the container itself gets shorter.
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)

        controller().model.setState(questionStateChanged())
        layout()

        assertTrue(find<QuestionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<QuestionView>(ui).parent)
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test connection panel is unaffected by active permission view`() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        showConnection()
        layout()
        val connection = find<ConnectionPanel>(ui)
        val prompt = find<PromptPanel>(ui)
        val root = find<SessionRootPanel>(ui)
        // Anchored above the bottom container, not at a fixed y: a pending permission makes the branch
        // dock release its row, so the container itself gets shorter.
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)

        controller().model.setState(permissionStateChanged())
        layout()

        assertTrue(find<PermissionView>(ui).isVisible)
        assertSame(find<SessionMessageListPanel>(ui), find<PermissionView>(ui).parent)
        assertEquals(bottomTop(root, prompt) - SessionUiStyle.View.contentGap(), connection.y + connection.height)
        assertSame(find<SessionMessageListPanel>(ui), scrollView())
    }

    fun `test active question view renders inside message scroll view`() {
        rpc.history.addAll(history(1))
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
        rpc.history.addAll(history(1))
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


    fun `test rollback keeps transcript and shows inline progress`() {
        showMessages()
        emit(ChatEventDto.MessageUpdated("ses_test", message("msg1")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("p_msg1", "msg1", "text", "hello")))
        settle()
        layout()
        val panel = find<SessionMessageListPanel>(ui)
        assertSame(panel, scrollView())
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().revert("msg1")
        }
        settle()
        layout()

        assertSame(panel, scrollView())
        val progress = find<RevertProgress>(panel.findMessage("msg1")!!)
        assertNotNull(progress)

        gate.complete(Unit)
        settle()
        layout()

        assertSame(panel, scrollView())
        assertNull(find(panel.findMessage("msg1")!!, RevertProgress::class.java))
    }

    fun `test cancel revert clears inline rollback progress`() {
        showMessages()
        emit(ChatEventDto.MessageUpdated("ses_test", message("msg1")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("p_msg1", "msg1", "text", "hello")))
        settle()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().revert("msg1")
        }
        settle()
        layout()
        val panel = find<SessionMessageListPanel>(ui)
        assertSame(panel, scrollView())
        assertNotNull(find<RevertProgress>(panel.findMessage("msg1")!!))

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller().cancelRevert()
        }
        settle()
        layout()

        assertSame(panel, scrollView())
        assertNull(find(panel.findMessage("msg1")!!, RevertProgress::class.java))
        assertTrue(rpc.reverts.isEmpty())
        gate.complete(Unit)
        settle()
        layout()

        assertSame(panel, scrollView())
        assertNull(find(panel.findMessage("msg1")!!, RevertProgress::class.java))
        assertTrue(rpc.reverts.isEmpty())
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

    fun `test empty explicit session id shows empty panel`() {
        rpc.recent.add(session("ses_recent"))
        settle()
        rpc.recentCalls.clear()

        ui = newUi(id = "ses_test")
        settle()

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel.view, scrollView())
        assertNull(find(ui, SessionMessageListPanel::class.java))
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

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel.view, scrollView())
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

        val panel = find<EmptySessionPanel>(ui)
        assertSame(panel.view, scrollView())
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

    fun `test account overlay stays hidden when prompt races empty history load`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = ProfileDto(email = "user@example.com"))
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        ui = newUi(id = "ses_test")

        ApplicationManager.getApplication().invokeAndWait {
            controller().prompt("hello")
        }
        gate.complete(Unit)
        settle()

        val overlay = find<SessionAccountOverlay>(ui)
        assertFalse(overlay.isVisible)
    }

    fun `test non-empty explicit session does not show overlay`() {
        rpc.history.add(MessageWithPartsDto(message("msg1"), emptyList()))
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

    private fun promptPoint(root: SessionRootPanel, prompt: PromptPanel) =
        SwingUtilities.convertPoint(prompt.parent, prompt.x, prompt.y, root.overlay)

    // Top of the bottom container (branch dock + prompt) in overlay coordinates. The connection
    // banner anchors above this so it floats over the dock rather than covering it.
    private fun bottomTop(root: SessionRootPanel, prompt: PromptPanel): Int {
        val container = prompt.parent.parent
        return SwingUtilities.convertPoint(container.parent, container.x, container.y, root.overlay).y
    }

    private fun layoutReadonly() {
        ui.doLayout()
        val root = find<SessionRootPanel>(ui)
        root.doLayout()
        root.content.doLayout()
        scrollComponent().doLayout()
        (scrollView() as? java.awt.Container)?.doLayout()
    }

    private fun lines(count: Int) = (1..count).joinToString("\n") { "line $it" }

    private class Row(override val sessionViewKind: SessionView.Kind) : JPanel(), SessionView {
        override fun getPreferredSize() = Dimension(100, 10)
    }
}
