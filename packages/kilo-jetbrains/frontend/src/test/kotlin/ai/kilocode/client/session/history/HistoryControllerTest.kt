package ai.kilocode.client.session.history

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
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

        controller.reloadCloud(gitUrl = "git@example.com:repo.git")
        flush()

        assertEquals(1, controller.cloud.items.size)
        assertEquals("cloud_1", controller.cloud.items[0].id)
        assertEquals("next_1", controller.cloud.cursor)
        assertEquals(FakeSessionRpcApi.CloudCall("/test", null, 150, "git@example.com:repo.git"), rpc.cloudCalls[0])

        rpc.cloud.clear()
        rpc.cloud += cloud("cloud_2", "Cloud Two")
        rpc.cloudCursor = null
        controller.loadMoreCloud()
        flush()

        assertEquals(listOf("cloud_1", "cloud_2"), controller.cloud.items.map { it.id })
        assertEquals(FakeSessionRpcApi.CloudCall("/test", "next_1", 150, "git@example.com:repo.git"), rpc.cloudCalls[1])
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
        assertFalse(panel.listFocusable())
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
        assertFalse(panel.listFocusable())
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

    fun `test local renderer exposes delete and cloud renderer hides it`() {
        rpc.listed += session("ses_1", "Local")
        rpc.cloud += cloud("cloud_1", "Cloud")
        val panel = HistoryPanel(parent, controller())
        flush()

        assertTrue(panel.deleteVisible(0))

        panel.clickCloud()
        flush()
        assertFalse(panel.cloudDeleteVisible(0))
    }

    private fun controller() = HistoryController(sessions, workspace, scope)

    private fun controller(opened: MutableList<String>) = HistoryController(sessions, workspace, scope, open = { open ->
        val id = when (open) {
            is SessionRef.Local -> open.id
            is SessionRef.Cloud -> "cloud:${open.id}"
        }
        opened.add(id)
    })

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
