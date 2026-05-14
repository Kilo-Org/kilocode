package ai.kilocode.client.session.history

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Cursor
import java.awt.event.KeyEvent
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener

@Suppress("UnstableApiUsage")
class HistoryControllerTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var parent: Disposable
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var workspace: Workspace

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        parent = Disposer.newDisposable("history")
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, scope, rpc)
        val workspaces = KiloWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test local load maps sessions and events`() {
        rpc.listed += session("ses_1", "Local One")
        val controller = controller()
        val events = collect(controller)

        controller.reloadLocal()
        flush()

        assertEquals(listOf("/test"), rpc.lists)
        assertEquals(1, controller.local.items.size)
        assertEquals("ses_1", controller.local.items[0].id)
        assertEquals("Local One", controller.local.items[0].title)
        assertEquals("loading=true size=0 error=null\nloading=false size=1 error=null", events.joinToString("\n"))
    }

    fun `test cloud load maps sessions and supports load more`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        rpc.cloudCursor = "next_1"
        val controller = controller()

        controller.reloadCloud()
        flush()

        assertEquals(1, controller.cloud.items.size)
        assertEquals("cloud_1", controller.cloud.items[0].id)
        assertEquals("next_1", controller.cloud.cursor)
        assertEquals(FakeSessionRpcApi.CloudCall("/test", null, 50, null), rpc.cloudCalls[0])

        rpc.cloud.clear()
        rpc.cloud += cloud("cloud_2", "Cloud Two")
        rpc.cloudCursor = null
        controller.loadMoreCloud()
        flush()

        assertEquals(listOf("cloud_1", "cloud_2"), controller.cloud.items.map { it.id })
        assertEquals(FakeSessionRpcApi.CloudCall("/test", "next_1", 50, null), rpc.cloudCalls[1])
    }

    fun `test local delete calls rpc and removes item`() {
        rpc.listed += session("ses_1", "Local One")
        val controller = controller()
        controller.reloadLocal()
        flush()

        controller.delete(controller.local.items[0])
        flush()

        assertEquals(listOf("ses_1" to "/test"), rpc.deletes)
        assertTrue(controller.local.items.isEmpty())
    }

    fun `test panel filters and switches source`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        rpc.cloud += cloud("cloud_1", "Cloud")
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        assertEquals(2, panel.itemCount())
        panel.setSearch("alp")
        assertEquals(1, panel.itemCount())

        panel.clickCloud()
        flush()

        assertEquals(HistorySource.CLOUD, panel.selectedSource())
        panel.setSearch("")
        assertEquals(1, panel.itemCount())
    }

    fun `test panel shows back button with tabs`() {
        val panel = HistoryPanel(parent, controller())
        flush()

        assertEquals(KiloBundle.message("history.back"), panel.backText())

        panel.clickCloud()
        flush()

        assertEquals(KiloBundle.message("history.back"), panel.backText())
    }

    fun `test panel back button invokes callback`() {
        var calls = 0
        val panel = HistoryPanel(parent, controller(), nav = { calls++ })
        flush()

        panel.clickBack()

        assertEquals(1, calls)
    }

    fun `test history actions use hand cursor`() {
        val panel = HistoryPanel(parent, controller())
        flush()

        assertEquals(Cursor.HAND_CURSOR, panel.backCursor())
        assertEquals(Cursor.HAND_CURSOR, panel.listCursor())

        panel.clickCloud()
        flush()

        assertEquals(Cursor.HAND_CURSOR, panel.backCursor())
        assertEquals(Cursor.HAND_CURSOR, panel.listCursor())
    }

    fun `test panel preserves independent search per source`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        rpc.cloud += cloud("cloud_1", "Cloud Alpha")
        rpc.cloud += cloud("cloud_2", "Cloud Beta")
        val panel = HistoryPanel(parent, controller())
        flush()

        panel.setSearch("alp")
        assertEquals(1, panel.itemCount())

        panel.clickCloud()
        flush()
        assertEquals(2, panel.itemCount())
        panel.setSearch("beta")
        assertEquals(1, panel.itemCount())

        panel.clickLocal()
        assertEquals(1, panel.itemCount())
    }

    fun `test panel focuses active search and moves list selection from search`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        rpc.cloud += cloud("cloud_1", "Cloud One")
        rpc.cloud += cloud("cloud_2", "Cloud Two")
        val panel = HistoryPanel(parent, controller())
        flush()

        val local = panel.defaultFocusedComponent
        assertTrue(panel.listFocusable())
        assertEquals(-1, panel.selectedIndex())
        key(local, KeyEvent.VK_DOWN)
        assertEquals(0, panel.selectedIndex())
        key(local, KeyEvent.VK_DOWN)
        assertEquals(1, panel.selectedIndex())
        key(local, KeyEvent.VK_UP)
        assertEquals(0, panel.selectedIndex())

        panel.clickCloud()
        flush()

        val cloud = panel.defaultFocusedComponent
        assertNotSame(local, cloud)
        assertTrue(panel.listFocusable())
        assertEquals(-1, panel.selectedIndex())
        key(cloud, KeyEvent.VK_DOWN)
        assertEquals(0, panel.selectedIndex())
    }

    fun `test panel opens selected local session on enter from search`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        val opened = mutableListOf<String>()
        val panel = HistoryPanel(parent, controller(opened))
        flush()

        val search = panel.defaultFocusedComponent
        key(search, KeyEvent.VK_DOWN)
        key(search, KeyEvent.VK_DOWN)
        key(search, KeyEvent.VK_ENTER)

        assertEquals(listOf("ses_2"), opened)
    }

    fun `test panel opens selected cloud session immediately on enter from search`() {
        rpc.cloud += cloud("cloud_1", "Cloud")
        rpc.importedCloudSession = session("ses_imported", "Imported")
        val opened = mutableListOf<String>()
        val panel = HistoryPanel(parent, controller(opened))
        flush()

        panel.clickCloud()
        flush()
        val search = panel.defaultFocusedComponent
        key(search, KeyEvent.VK_DOWN)
        key(search, KeyEvent.VK_ENTER)
        flush()

        assertTrue(rpc.imports.isEmpty())
        assertEquals(listOf("cloud:cloud_1"), opened)
    }

    fun `test panel refresh reloads local history`() {
        rpc.listed += session("ses_1", "One")
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        assertEquals(listOf("ses_1"), controller.local.items.map { it.id })

        rpc.listed.clear()
        rpc.listed += session("ses_2", "Two")
        panel.refresh()
        flush()

        assertEquals(listOf("ses_2"), controller.local.items.map { it.id })
    }

    fun `test panel groups sessions by date`() {
        val now = Instant.now()
        rpc.listed += session("ses_today", "Today", now.toEpochMilli().toDouble())
        rpc.listed += session("ses_yesterday", "Yesterday", now.minus(1, ChronoUnit.DAYS).toEpochMilli().toDouble())
        rpc.listed += session("ses_week", "Week", now.minus(3, ChronoUnit.DAYS).toEpochMilli().toDouble())
        rpc.listed += session("ses_month", "Month", now.minus(10, ChronoUnit.DAYS).toEpochMilli().toDouble())
        rpc.listed += session("ses_older", "Older", now.minus(60, ChronoUnit.DAYS).toEpochMilli().toDouble())
        val panel = HistoryPanel(parent, controller())
        flush()

        assertTrue(panel.groupTitles().containsAll(listOf("Today", "Yesterday", "This Week", "Older")))
    }

    fun `test cloud history uses relative time and sections`() {
        val now = Instant.now()
        val today = CloudHistoryItem(cloud("cloud_today", "Today", now.minus(5, ChronoUnit.HOURS)))
        val yesterday = CloudHistoryItem(cloud("cloud_yesterday", "Yesterday", now.minus(1, ChronoUnit.DAYS)))
        val offset = CloudHistoryItem(
            cloud(
                "cloud_offset",
                "Offset",
                now.minus(10, ChronoUnit.HOURS).toString().replace("Z", "+00"),
            ),
        )

        assertEquals(KiloBundle.message("history.time.hours", 5), HistoryTime.relative(today, now.toEpochMilli()))
        assertEquals(HistorySection.TODAY, HistoryTime.section(today, now.toEpochMilli()))
        assertEquals(HistorySection.YESTERDAY, HistoryTime.section(yesterday, now.toEpochMilli()))
        assertEquals(KiloBundle.message("history.time.hours", 10), HistoryTime.relative(offset, now.toEpochMilli()))
    }

    fun `test history section boundaries are inclusive at 7 and 30 days`() {
        val now = Instant.now()
        val exactly7 = LocalHistoryItem(session("s7", "7d", now.minus(7, ChronoUnit.DAYS).toEpochMilli().toDouble()))
        val exactly30 = LocalHistoryItem(session("s30", "30d", now.minus(30, ChronoUnit.DAYS).toEpochMilli().toDouble()))
        val within7 = LocalHistoryItem(session("s6", "6d", now.minus(6, ChronoUnit.DAYS).toEpochMilli().toDouble()))
        val within30 = LocalHistoryItem(session("s29", "29d", now.minus(29, ChronoUnit.DAYS).toEpochMilli().toDouble()))
        val beyond30 = LocalHistoryItem(session("s31", "31d", now.minus(31, ChronoUnit.DAYS).toEpochMilli().toDouble()))

        assertEquals(HistorySection.WEEK, HistoryTime.section(exactly7, now.toEpochMilli()))
        assertEquals(HistorySection.WEEK, HistoryTime.section(within7, now.toEpochMilli()))
        assertEquals(HistorySection.MONTH, HistoryTime.section(exactly30, now.toEpochMilli()))
        assertEquals(HistorySection.MONTH, HistoryTime.section(within30, now.toEpochMilli()))
        assertEquals(HistorySection.OLDER, HistoryTime.section(beyond30, now.toEpochMilli()))
    }

    fun `test list is focusable and uses multiple interval selection`() {
        val panel = HistoryPanel(parent, controller())
        flush()

        assertTrue(panel.listFocusable())
        assertEquals(javax.swing.ListSelectionModel.MULTIPLE_INTERVAL_SELECTION, panel.listSelectionMode())
    }

    fun `test load more button is focusable`() {
        rpc.cloud += cloud("cloud_1", "Cloud")
        rpc.cloudCursor = "next"
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        assertTrue(panel.loadMoreFocusable())
    }

    fun `test rename updates local item title`() {
        rpc.listed += session("ses_1", "Original")
        val controller = controller()
        flush()

        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        controller.rename(item, "Renamed")
        flush()

        assertEquals("Renamed", controller.local.items[0].title)
        assertEquals(listOf(Triple("ses_1", "/test", "Renamed")), rpc.renames)
    }

    fun `test data context exposes selection and controller`() {
        rpc.listed += session("ses_1", "Alpha")
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        panel.select(0)

        val sel = panel.getData(HistoryDataKeys.SELECTION.name) as? HistorySelection
        assertNotNull(sel)
        assertEquals(1, sel!!.selectedLocal.size)
        assertEquals("ses_1", sel.selectedLocal[0].id)

        val ctrl = panel.getData(HistoryDataKeys.CONTROLLER.name)
        assertSame(controller, ctrl)
    }

    // ------ Multi-selection and cloud selection data context ------

    fun `test data context exposes local multi-selection`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        panel.selectIndices(0, 1)

        val sel = panel.getData(HistoryDataKeys.SELECTION.name) as? HistorySelection
        assertNotNull(sel)
        assertEquals(HistorySource.LOCAL, sel!!.source)
        assertEquals(2, sel.selectedLocal.size)
        assertTrue(sel.selectedLocal.map { it.id }.containsAll(listOf("ses_1", "ses_2")))
    }

    fun `test data context exposes cloud selection`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        panel.clickCloud()
        flush()
        panel.select(0)

        val sel = panel.getData(HistoryDataKeys.SELECTION.name) as? HistorySelection
        assertNotNull(sel)
        assertEquals(HistorySource.CLOUD, sel!!.source)
        assertTrue(sel.selectedLocal.isEmpty())
        assertEquals(1, sel.cloudItems.size)
        assertEquals("cloud_1", sel.cloudItems[0].id)
    }

    fun `test data context exposes session manager`() {
        val manager = FakeManager()
        val controller = controller()
        val panel = HistoryPanel(parent, controller, manager = manager)
        flush()

        assertSame(manager, panel.getData(SessionManager.KEY.name))
    }

    fun `test data context returns null for absent session manager`() {
        val controller = controller()
        val panel = HistoryPanel(parent, controller)
        flush()

        assertNull(panel.getData(SessionManager.KEY.name))
    }

    fun `test local list uses multiple interval selection mode`() {
        val panel = HistoryPanel(parent, controller())
        flush()

        assertEquals(javax.swing.ListSelectionModel.MULTIPLE_INTERVAL_SELECTION, panel.listSelectionMode())
    }

    fun `test cloud list uses single selection mode`() {
        val panel = HistoryPanel(parent, controller())
        flush()

        panel.clickCloud()
        flush()

        assertEquals(javax.swing.ListSelectionModel.SINGLE_SELECTION, panel.listSelectionMode())
    }

    // ------ Rename failure and directory selection ------

    fun `test rename failure keeps original title and sets error`() {
        rpc.listed += session("ses_1", "Original")
        val controller = controller()
        controller.reloadLocal()
        flush()

        rpc.renameThrows = IllegalStateException("rename failed")
        val item = controller.local.items[0]
        controller.rename(item, "Renamed")
        flush()

        assertEquals("Original", controller.local.items[0].title)
        assertNotNull(controller.local.error)
    }

    fun `test rename uses item directory when present`() {
        val dto = session("ses_1", "Original").copy(directory = "/worktree/path")
        rpc.listed += dto
        val controller = controller()
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        assertEquals("/worktree/path", item.directory)

        controller.rename(item, "Renamed")
        flush()

        assertEquals(listOf(Triple("ses_1", "/worktree/path", "Renamed")), rpc.renames)
    }

    fun `test rename falls back to workspace directory when item directory is workspace`() {
        // When session.directory matches workspace directory (not a worktree override)
        rpc.listed += session("ses_1", "Original")
        val controller = controller()
        controller.reloadLocal()
        flush()

        val item = controller.local.items[0]
        controller.rename(item, "Renamed")
        flush()

        assertEquals(listOf(Triple("ses_1", "/test", "Renamed")), rpc.renames)
    }

    // ------ HistoryModel update/sorting ------

    fun `test model update re-sorts items by updated time`() {
        val now = java.time.Instant.now()
        rpc.listed += session("ses_1", "Alpha", now.toEpochMilli().toDouble())
        rpc.listed += session("ses_2", "Beta", now.minusSeconds(100).toEpochMilli().toDouble())
        val controller = controller()
        controller.reloadLocal()
        flush()

        // ses_1 is newer so comes first
        assertEquals("ses_1", controller.local.items[0].id)

        // Update ses_2 to be newer
        val updated = session("ses_2", "Beta Updated", now.plusSeconds(100).toEpochMilli().toDouble())
        controller.local.update(LocalHistoryItem(updated))

        // Now ses_2 should come first
        assertEquals("ses_2", controller.local.items[0].id)
        assertEquals("Beta Updated", controller.local.items[0].title)
    }

    fun `test model update with unknown id leaves model unchanged`() {
        rpc.listed += session("ses_1", "Alpha")
        val controller = controller()
        controller.reloadLocal()
        flush()

        val before = controller.local.items.toList()
        val unknown = session("unknown_id", "Unknown")
        controller.local.update(LocalHistoryItem(unknown))

        assertEquals(before.map { it.id }, controller.local.items.map { it.id })
    }

    fun `test model update removes renamed item from active filter`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        val controller = controller()
        controller.reloadLocal()
        flush()

        controller.local.setFilter("alpha")
        assertEquals(listOf("ses_1"), controller.local.visibleItems.map { it.id })

        controller.local.update(LocalHistoryItem(session("ses_1", "Gamma")))

        assertTrue(controller.local.visibleItems.isEmpty())
    }

    fun `test model update adds renamed item to active filter`() {
        rpc.listed += session("ses_1", "Alpha")
        rpc.listed += session("ses_2", "Beta")
        val controller = controller()
        controller.reloadLocal()
        flush()

        controller.local.setFilter("gamma")
        assertTrue(controller.local.visibleItems.isEmpty())

        controller.local.update(LocalHistoryItem(session("ses_2", "Gamma")))

        assertEquals(listOf("ses_2"), controller.local.visibleItems.map { it.id })
    }

    fun `test cloud load passes git url when repo only enabled`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val url = "git@github.com:test/repo.git"
        val controller = controllerWithGit(url)

        controller.reloadCloud()
        flush()

        assertEquals(1, rpc.cloudCalls.size)
        assertEquals(url, rpc.cloudCalls[0].gitUrl)
        assertEquals(true, controller.repoOnly)
        assertEquals(url, controller.gitUrl)
    }

    fun `test cloud load passes null when no git url`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val controller = controllerWithGit(null)

        controller.reloadCloud()
        flush()

        assertEquals(1, rpc.cloudCalls.size)
        assertNull(rpc.cloudCalls[0].gitUrl)
        assertEquals(false, controller.repoOnly)
        assertNull(controller.gitUrl)
    }

    fun `test cloud git url resolves once across overlapping reloads`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val calls = AtomicInteger()
        val controller = HistoryController(sessions, workspace, scope, gitUrlProvider = {
            calls.incrementAndGet()
            Thread.sleep(100)
            "git@github.com:test/repo.git"
        })

        controller.reloadCloud()
        controller.reloadCloud()
        flush()

        assertEquals(1, calls.get())
        assertEquals(2, rpc.cloudCalls.size)
    }

    fun `test cloud load passes null when repo only disabled`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val url = "git@github.com:test/repo.git"
        val controller = controllerWithGit(url)

        controller.reloadCloud()
        flush()
        assertEquals(url, rpc.cloudCalls[0].gitUrl)

        controller.applyRepoOnly(false)
        flush()

        assertEquals(2, rpc.cloudCalls.size)
        assertNull(rpc.cloudCalls[1].gitUrl)
    }

    fun `test load more passes git url when repo only enabled`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        rpc.cloudCursor = "next_1"
        val url = "git@github.com:test/repo.git"
        val controller = controllerWithGit(url)

        controller.reloadCloud()
        flush()

        rpc.cloud.clear()
        rpc.cloud += cloud("cloud_2", "Cloud Two")
        rpc.cloudCursor = null
        controller.loadMoreCloud()
        flush()

        assertEquals(2, rpc.cloudCalls.size)
        assertEquals(url, rpc.cloudCalls[1].gitUrl)
    }

    fun `test repo only checkbox visible only when git url exists`() {
        val url = "git@github.com:test/repo.git"
        val panel = HistoryPanel(parent, controllerWithGit(url))
        flush()

        panel.clickCloud()
        flush()

        assertTrue(panel.repoOnlyVisible())
        assertTrue(panel.repoOnlySelected())
    }

    fun `test repo only checkbox hidden when no git url`() {
        val panel = HistoryPanel(parent, controllerWithGit(null))
        flush()

        panel.clickCloud()
        flush()

        assertFalse(panel.repoOnlyVisible())
    }

    fun `test repo only checkbox toggle reloads cloud history`() {
        rpc.cloud += cloud("cloud_1", "Cloud One")
        val url = "git@github.com:test/repo.git"
        val panel = HistoryPanel(parent, controllerWithGit(url))
        flush()

        panel.clickCloud()
        flush()

        val before = rpc.cloudCalls.size

        panel.clickRepoOnly()
        flush()

        assertTrue(rpc.cloudCalls.size > before)
        assertFalse(panel.repoOnlySelected())
    }

    private fun controller() = HistoryController(sessions, workspace, scope)

    private fun controllerWithGit(url: String?) = HistoryController(
        sessions,
        workspace,
        scope,
        gitUrlProvider = { url },
    )

    private fun controller(opened: MutableList<String>) = HistoryController(sessions, workspace, scope, open = { open ->
        val id = when (open) {
            is SessionRef.Local -> open.id
            is SessionRef.Cloud -> "cloud:${open.id}"
        }
        opened.add(id)
    })

    private class FakeManager : SessionManager {
        override fun newSession() {}
        override fun showHistory() {}
        override fun openSession(ref: SessionRef) {}
    }

    private fun collect(controller: HistoryController): MutableList<String> {
        val events = mutableListOf<String>()
        val listener = object : ListDataListener {
            override fun intervalAdded(e: ListDataEvent) = record()

            override fun intervalRemoved(e: ListDataEvent) = record()

            override fun contentsChanged(e: ListDataEvent) = record()

            private fun record() {
                assertTrue(ApplicationManager.getApplication().isDispatchThread)
                events.add("loading=${controller.local.loading} size=${controller.local.items.size} error=${controller.local.error}")
            }
        }
        controller.local.addListDataListener(listener)
        Disposer.register(parent) { controller.local.removeListDataListener(listener) }
        return events
    }

    private fun flush() = runBlocking {
        repeat(5) {
            delay(100)
            ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun key(component: JComponent, code: Int) {
        val action = component.getActionForKeyStroke(KeyStroke.getKeyStroke(code, 0))
        requireNotNull(action).actionPerformed(null)
    }

    private fun session(id: String, title: String, updated: Double = 2.0) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = updated),
    )

    private fun cloud(id: String, title: String, updated: Instant = Instant.parse("2026-01-02T00:00:00Z")) = cloud(id, title, updated.toString())

    private fun cloud(id: String, title: String, updated: String) = CloudSessionDto(
        id = id,
        title = title,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = updated,
        version = 1.0,
    )
}
