package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.applySidePanelMode
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.CloudHistoryItem
import ai.kilocode.client.session.history.HistoryController
import ai.kilocode.client.session.history.HistoryDataKeys
import ai.kilocode.client.session.history.HistorySelection
import ai.kilocode.client.session.history.HistorySource
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.content.ContentManager
import java.lang.reflect.Proxy
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class HistorySessionActionsTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var workspace: Workspace
    private lateinit var controller: HistoryController
    private lateinit var manager: FakeManager
    /** Counts fully-completed deletes (incremented on EDT after local.remove). */
    @Volatile
    private var deleteCount = 0

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, coroutines.scope, rpc)
        val workspaces = KiloWorkspaceService(coroutines.scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
        controller = HistoryController(sessions, workspace, coroutines.scope, deleted = { deleteCount++ })
        manager = FakeManager()
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    // ------ OpenSessionAction.update ------

    fun `test open action enabled for single local selection`() {
        val action = OpenSessionAction()
        val local = localItem("ses_1")
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(local)), controller)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isEnabledAndVisible)
    }

    fun `test open action enabled for single cloud selection`() {
        val action = OpenSessionAction()
        val item = cloudItem("cloud_1")
        val event = event(action, manager, selection(HistorySource.CLOUD, emptyList(), listOf(item)), controller)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isEnabledAndVisible)
    }

    fun `test open action disabled without manager`() {
        val action = OpenSessionAction()
        val local = localItem("ses_1")
        val event = event(action, null, selection(HistorySource.LOCAL, listOf(local)), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test open action disabled with no selection`() {
        val action = OpenSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, emptyList()), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test open action disabled with multiple local items`() {
        val action = OpenSessionAction()
        val items = listOf(localItem("ses_1"), localItem("ses_2"))
        val event = event(action, manager, selection(HistorySource.LOCAL, items), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    // ------ OpenSessionAction.actionPerformed ------

    fun `test open action performs opens local item`() {
        val opened = mutableListOf<String>()
        val ctrl = HistoryController(sessions, workspace, coroutines.scope, open = { ref ->
            when (ref) {
                is SessionRef.Local -> opened.add(ref.id)
                is SessionRef.Cloud -> opened.add("cloud:${ref.id}")
            }
        })
        val local = localItem("ses_1")
        val action = OpenSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(local)), ctrl)

        action.actionPerformed(event)
        flush()

        assertEquals(listOf("ses_1"), opened)
    }

    fun `test open action performs opens cloud item`() {
        val opened = mutableListOf<String>()
        val ctrl = HistoryController(sessions, workspace, coroutines.scope, open = { ref ->
            when (ref) {
                is SessionRef.Local -> opened.add(ref.id)
                is SessionRef.Cloud -> opened.add("cloud:${ref.id}")
            }
        })
        val item = cloudItem("cloud_1")
        val action = OpenSessionAction()
        val event = event(action, manager, selection(HistorySource.CLOUD, emptyList(), listOf(item)), ctrl)

        action.actionPerformed(event)
        flush()

        assertEquals(listOf("cloud:cloud_1"), opened)
    }

    // ------ DeleteSessionAction.update ------

    fun `test delete action enabled for non-empty local selection`() {
        val action = DeleteSessionAction()
        val local = localItem("ses_1")
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(local)), controller)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isEnabledAndVisible)
    }

    fun `test delete action disabled for cloud-only selection`() {
        val action = DeleteSessionAction()
        val item = cloudItem("cloud_1")
        val event = event(action, manager, selection(HistorySource.CLOUD, emptyList(), listOf(item)), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test delete action disabled without manager`() {
        val action = DeleteSessionAction()
        val local = localItem("ses_1")
        val event = event(action, null, selection(HistorySource.LOCAL, listOf(local)), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test delete action disabled with empty selection`() {
        val action = DeleteSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, emptyList()), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    // ------ DeleteSessionAction.actionPerformed ------

    fun `test delete action deletes selected local items after confirmation`() {
        rpc.listed += sessionDto("ses_1", "One")
        rpc.listed += sessionDto("ses_2", "Two")
        controller.reloadLocal()
        flush()

        assertEquals(2, controller.local.items.size)

        val items = controller.local.items.toList()
        val action = DeleteSessionAction().apply { confirm = { _, _ -> true } }
        val event = event(action, manager, selection(HistorySource.LOCAL, items), controller)

        action.actionPerformed(event)
        awaitDeletes(2)
        assertEquals(listOf("ses_1", "ses_2"), rpc.deletes.map { it.first }.sorted())
        assertTrue(controller.local.items.isEmpty())
    }

    fun `test delete action skips items already being deleted`() {
        rpc.listed += sessionDto("ses_1", "One")
        controller.reloadLocal()
        flush()

        rpc.deleteGate = kotlinx.coroutines.CompletableDeferred()
        val item = controller.local.items[0]
        controller.delete(item)
        waitFor { controller.deleting(item) }

        val action = DeleteSessionAction().apply { confirm = { _, _ -> true } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.deletes.isEmpty())

        rpc.deleteGate?.complete(Unit)
        awaitDeletes(1)

        assertEquals(listOf("ses_1"), rpc.deletes.map { it.first })
    }

    fun `test delete action cancelled when user says no`() {
        rpc.listed += sessionDto("ses_1", "One")
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        val action = DeleteSessionAction().apply { confirm = { _, _ -> false } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.deletes.isEmpty())
    }

    // ------ RenameSessionAction.update ------

    fun `test rename action enabled for exactly one local item`() {
        val action = RenameSessionAction()
        val local = localItem("ses_1")
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(local)), controller)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isEnabledAndVisible)
    }

    fun `test rename action disabled with no selection`() {
        val action = RenameSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, emptyList()), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test rename action disabled with multiple local items`() {
        val action = RenameSessionAction()
        val items = listOf(localItem("ses_1"), localItem("ses_2"))
        val event = event(action, manager, selection(HistorySource.LOCAL, items), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test rename action disabled for cloud selection`() {
        val action = RenameSessionAction()
        val item = cloudItem("cloud_1")
        val event = event(action, manager, selection(HistorySource.CLOUD, emptyList(), listOf(item)), controller)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    // ------ RenameSessionAction.actionPerformed ------

    fun `test rename action opens rename popover for single local selection`() {
        val item = localItem("ses_1")
        val renamed = mutableListOf<String>()
        val action = RenameSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller) { renamed += it.id }

        action.actionPerformed(event)

        assertEquals(listOf("ses_1"), renamed)
    }

    fun `test rename action does nothing without a rename provider`() {
        val item = localItem("ses_1")
        val action = RenameSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.renames.isEmpty())
    }

    fun `test rename action does nothing for multiple local selection`() {
        val items = listOf(localItem("ses_1"), localItem("ses_2"))
        val renamed = mutableListOf<String>()
        val action = RenameSessionAction()
        val event = event(action, manager, selection(HistorySource.LOCAL, items), controller) { renamed += it.id }

        action.actionPerformed(event)

        assertTrue(renamed.isEmpty())
    }

    fun `test history action selects chat content from agent manager`() = edtWait {
        val action = HistoryAction()
        val content = ContentFactory.getInstance().createContentManager(false, project)
        try {
            val chat = ContentFactory.getInstance().createContent(JPanel(), "Branch", false)
            val agent = ContentFactory.getInstance().createContent(JPanel(), "Agent Manager", false)
            chat.applySidePanelMode(SidePanelMode.CHAT)
            agent.applySidePanelMode(SidePanelMode.AGENT_MANAGER)
            content.addContent(chat)
            content.addContent(agent)
            content.setSelectedContent(agent)
            val event = event(action, manager, content)

            action.actionPerformed(event)

            assertSame(chat, content.selectedContent)
            assertEquals(1, manager.history)
            manager.back?.invoke()
            assertSame(agent, content.selectedContent)
        } finally {
            Disposer.dispose(content)
        }
    }

    fun `test frontend descriptor registers history actions`() {
        val xml = javaClass.classLoader.getResourceAsStream("kilo.jetbrains.frontend.xml")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: error("missing frontend descriptor")

        assertTrue(xml.contains("id=\"Kilo.Session.Open\""))
        assertTrue(xml.contains("id=\"Kilo.Session.Rename\""))
        assertTrue(xml.contains("id=\"Kilo.Session.Delete\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.Rename\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.Delete\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.OpenPr\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.CopyPrRef\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.OpenDiff\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.OpenLocalDiff\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.CopyBranchName\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.CopyBranchPath\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.RunSetupScript\""))
        assertTrue(xml.contains("id=\"Kilo.WorktreeSession.Rename\""))
        assertTrue(xml.contains("id=\"Kilo.WorktreeSession.Delete\""))
        assertTrue(xml.contains("id=\"Kilo.Worktree.RowMenu\""))
        assertTrue(xml.contains("id=\"Kilo.WorktreeSession.RowMenu\""))
        assertTrue(xml.contains("id=\"Kilo.History.ContextMenu\""))
        assertTrue(xml.contains("id=\"Kilo.Session.ContextMenu\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Open\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Rename\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Delete\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.Rename\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.Delete\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.OpenPr\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.CopyPrRef\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.OpenDiff\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.OpenLocalDiff\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.CopyBranchName\""))
        assertTrue(xml.contains("ref=\"Kilo.Worktree.CopyBranchPath\""))
        assertTrue(xml.contains("ref=\"Kilo.WorktreeSession.Rename\""))
        assertTrue(xml.contains("ref=\"Kilo.WorktreeSession.Delete\""))
        assertTrue(xml.contains("ref=\"${'$'}Copy\""))

        // Row menu order: rename, (separator), open pr, copy pr ref, open diff, open local diff,
        // (separator), copy branch name, copy branch path, (separator), open/create setup script,
        // run setup script, (separator), delete.
        val rowMenuStart = xml.indexOf("<group id=\"Kilo.Worktree.RowMenu\">")
        val rowMenuEnd = xml.indexOf("</group>", rowMenuStart)
        val rowMenu = xml.substring(rowMenuStart, rowMenuEnd)
        assertTrue(rowMenu.contains("ref=\"Kilo.OpenSetupScript\""))
        assertTrue(rowMenu.contains("ref=\"Kilo.Worktree.RunSetupScript\""))

        val rename = rowMenu.indexOf("ref=\"Kilo.Worktree.Rename\"")
        val openPr = rowMenu.indexOf("ref=\"Kilo.Worktree.OpenPr\"")
        val copyPrRef = rowMenu.indexOf("ref=\"Kilo.Worktree.CopyPrRef\"")
        val openDiff = rowMenu.indexOf("ref=\"Kilo.Worktree.OpenDiff\"")
        val openLocalDiff = rowMenu.indexOf("ref=\"Kilo.Worktree.OpenLocalDiff\"")
        val copyName = rowMenu.indexOf("ref=\"Kilo.Worktree.CopyBranchName\"")
        val copyPath = rowMenu.indexOf("ref=\"Kilo.Worktree.CopyBranchPath\"")
        val openSetup = rowMenu.indexOf("ref=\"Kilo.OpenSetupScript\"")
        val runSetup = rowMenu.indexOf("ref=\"Kilo.Worktree.RunSetupScript\"")
        val delete = rowMenu.indexOf("ref=\"Kilo.Worktree.Delete\"")
        assertTrue(
            rename in 0 until openPr && openPr < copyPrRef && copyPrRef < openDiff && openDiff < openLocalDiff &&
                openLocalDiff < copyName && copyName < copyPath && copyPath < openSetup &&
                openSetup < runSetup && runSetup < delete,
        )
    }

    // ------ Helpers ------

    private fun event(
        action: com.intellij.openapi.actionSystem.AnAction,
        manager: SessionManager?,
        selection: HistorySelection,
        ctrl: HistoryController,
        rename: ((LocalHistoryItem) -> Unit)? = null,
    ): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id ->
            when {
                CommonDataKeys.PROJECT.`is`(id) -> project
                SessionManager.KEY.`is`(id) -> manager
                HistoryDataKeys.SELECTION.`is`(id) -> selection
                HistoryDataKeys.CONTROLLER.`is`(id) -> ctrl
                HistoryDataKeys.RENAME.`is`(id) -> rename
                else -> null
            }
        }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private fun event(
        action: com.intellij.openapi.actionSystem.AnAction,
        manager: SessionManager,
        content: ContentManager,
    ): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val tool = Proxy.newProxyInstance(
            ToolWindow::class.java.classLoader,
            arrayOf(ToolWindow::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "getContentManager" -> content
                else -> error("unexpected ToolWindow method ${method.name}")
            }
        } as ToolWindow
        val context = DataContext { id ->
            when {
                SessionManager.KEY.`is`(id) -> manager
                SidePanelKeys.MODE.`is`(id) -> SidePanelMode.AGENT_MANAGER
                PlatformDataKeys.TOOL_WINDOW.`is`(id) -> tool
                else -> null
            }
        }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private fun selection(
        source: HistorySource,
        local: List<LocalHistoryItem>,
        cloud: List<CloudHistoryItem> = emptyList(),
    ) = HistorySelection(source, local, cloud)

    private fun localItem(id: String, title: String = id) = LocalHistoryItem(sessionDto(id, title))

    private fun sessionDto(id: String, title: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private fun cloudItem(id: String, title: String = id) = CloudHistoryItem(
        CloudSessionDto(
            id = id,
            title = title,
            createdAt = "2026-01-01T00:00:00Z",
            updatedAt = "2026-01-02T00:00:00Z",
            version = 1.0,
        )
    )

    /** Waits until [n] deletes have fully completed (deleted callback fired on EDT after local.remove). */
    private fun awaitDeletes(n: Int) {
        waitFor { deleteCount >= n }
    }

    private fun flush() = coroutines.drain()

    private fun pump() = pumpEdt()

    private fun waitFor(done: () -> Boolean) {
        assertTrue(coroutines.pumpUntil(cond = done))
    }

    private class FakeManager : SessionManager {
        var history = 0
        var back: (() -> Unit)? = null

        override fun newSession() {}
        override fun showHistory(back: (() -> Unit)?) {
            history++
            this.back = back
        }

        override fun openSession(ref: SessionRef) {}
    }
}
