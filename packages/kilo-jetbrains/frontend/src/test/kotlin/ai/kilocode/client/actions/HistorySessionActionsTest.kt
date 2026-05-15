package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
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
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

@Suppress("UnstableApiUsage")
class HistorySessionActionsTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var workspace: Workspace
    private lateinit var controller: HistoryController
    private lateinit var manager: FakeManager

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, scope, rpc)
        val workspaces = KiloWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
        controller = HistoryController(sessions, workspace, scope)
        manager = FakeManager()
    }

    override fun tearDown() {
        try {
            scope.cancel()
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
        val ctrl = HistoryController(sessions, workspace, scope, open = { ref ->
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
        val ctrl = HistoryController(sessions, workspace, scope, open = { ref ->
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
        flush()

        assertEquals(listOf("ses_1", "ses_2"), rpc.deletes.map { it.first })
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
        waitFor { rpc.deletes.size == 1 }
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

    fun `test rename action calls controller with trimmed changed title`() {
        rpc.listed += sessionDto("ses_1", "Original")
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        val action = RenameSessionAction().apply { input = { _, _ -> "  Renamed  " } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertEquals(listOf(Triple("ses_1", "/test", "Renamed")), rpc.renames)
    }

    fun `test rename action passes displayed current title to input`() {
        rpc.listed += sessionDto("ses_1", "Original")
        controller.reloadLocal()
        flush()

        val prompts = mutableListOf<String>()
        val item = controller.local.items[0]
        val action = RenameSessionAction().apply {
            input = { _, current ->
                prompts.add(current)
                null
            }
        }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertEquals(listOf("Original"), prompts)
        assertTrue(rpc.renames.isEmpty())
    }

    fun `test rename action passes untitled fallback to input`() {
        rpc.listed += sessionDto("ses_1", "")
        controller.reloadLocal()
        flush()

        val prompts = mutableListOf<String>()
        val item = controller.local.items[0]
        val action = RenameSessionAction().apply {
            input = { _, current ->
                prompts.add(current)
                null
            }
        }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertEquals(listOf(KiloBundle.message("history.untitled")), prompts)
        assertTrue(rpc.renames.isEmpty())
    }

    fun `test rename action ignores blank input`() {
        rpc.listed += sessionDto("ses_1", "Original")
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        val action = RenameSessionAction().apply { input = { _, _ -> "   " } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.renames.isEmpty())
    }

    fun `test rename action ignores unchanged input`() {
        rpc.listed += sessionDto("ses_1", "Original")
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        val action = RenameSessionAction().apply { input = { _, _ -> "Original" } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.renames.isEmpty())
    }

    fun `test rename action ignores null input`() {
        rpc.listed += sessionDto("ses_1", "Original")
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        val action = RenameSessionAction().apply { input = { _, _ -> null } }
        val event = event(action, manager, selection(HistorySource.LOCAL, listOf(item)), controller)

        action.actionPerformed(event)
        flush()

        assertTrue(rpc.renames.isEmpty())
    }

    fun `test frontend descriptor registers history actions`() {
        val xml = javaClass.classLoader.getResourceAsStream("kilo.jetbrains.frontend.xml")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: error("missing frontend descriptor")

        assertTrue(xml.contains("id=\"Kilo.Session.Open\""))
        assertTrue(xml.contains("id=\"Kilo.Session.Rename\""))
        assertTrue(xml.contains("id=\"Kilo.Session.Delete\""))
        assertTrue(xml.contains("id=\"Kilo.History.ContextMenu\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Open\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Rename\""))
        assertTrue(xml.contains("ref=\"Kilo.Session.Delete\""))
    }

    // ------ Helpers ------

    private fun event(
        action: com.intellij.openapi.actionSystem.AnAction,
        manager: SessionManager?,
        selection: HistorySelection,
        ctrl: HistoryController,
    ): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id ->
            when {
                CommonDataKeys.PROJECT.`is`(id) -> project
                SessionManager.KEY.`is`(id) -> manager
                HistoryDataKeys.SELECTION.`is`(id) -> selection
                HistoryDataKeys.CONTROLLER.`is`(id) -> ctrl
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

    private fun flush() = runBlocking {
        repeat(10) {
            delay(100)
            ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun waitFor(done: () -> Boolean) = runBlocking {
        withTimeout(5_000) {
            while (!done()) {
                delay(25)
                ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
            }
        }
        ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
    }

    private class FakeManager : SessionManager {
        override fun newSession() {}
        override fun showHistory() {}
        override fun openSession(ref: SessionRef) {}
    }
}
