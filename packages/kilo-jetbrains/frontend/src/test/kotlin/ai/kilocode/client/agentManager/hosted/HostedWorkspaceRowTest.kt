package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.testing.rowTitle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.list.ActiveListBadgeCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.activeListLayout
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBList
import java.awt.Component
import java.awt.Container
import javax.swing.SwingUtilities

class HostedWorkspaceRowTest : BasePlatformTestCase() {
    fun `test row and tab titles prefer custom names then branches then workspace IDs`() {
        val dto = HostedWorkspaceDto(
            HostedWorkspaceRefDto("cloud", "wrk_1"),
            name = "Custom workspace",
            repositoryUrl = "https://example.test/owner/repository",
            branch = "feature/cloud",
        )
        val cases = listOf(
            dto to "Custom workspace",
            dto.copy(name = null) to "feature/cloud",
            dto.copy(name = " \t") to "feature/cloud",
            dto.copy(name = null, branch = null) to "wrk_1",
            dto.copy(name = " ", branch = " \t") to "wrk_1",
        )
        for ((item, expected) in cases) {
            val row = HostedWorkspaceRow(HostedWorkspaceRowData(item, null))
            val params = hostedWorkspaceParams(item)
            service<HostedWorkspaceCache>().put(item)
            assertEquals(expected, row.title)
            assertEquals(expected, HostedWorkspaceEditorKind.title(params))
            assertEquals(expected, HostedWorkspaceEditorKind.presentablePath(params))
        }
    }

    fun `test description shows only the branch even when root sessions exist`() {
        val dto = HostedWorkspaceDto(
            HostedWorkspaceRefDto("cloud", "wrk_1"),
            name = "Custom workspace",
            branch = "feature/cloud",
            sessions = listOf(HostedWorkspaceSessionDto("hosted:cloud:wrk_1:ses_1", "ses_1")),
        )
        assertEquals("feature/cloud", HostedWorkspaceRow(HostedWorkspaceRowData(dto, null)).description)
        assertNull(HostedWorkspaceRow(HostedWorkspaceRowData(dto.copy(branch = null), null)).description)
        assertNull(HostedWorkspaceRow(HostedWorkspaceRowData(dto.copy(branch = " \t"), null)).description)
    }

    fun `test rows tabs and file types use the same cloud icon`() {
        val row = row("sleeping")
        val params = hostedWorkspaceParams(row.data.dto)
        assertSame(HostedWorkspaceIcons.cloud, row.icon)
        assertSame(row.icon, HostedWorkspaceEditorKind.icon(params))
        assertSame(row.icon, HostedWorkspaceFileType.getIcon())
    }

    fun `test cloud icon has matching light and dark geometry with canonical palettes`() {
        val light = svg("cloud")
        val dark = svg("cloud_dark")
        assertTrue(light.contains("viewBox=\"0 0 16 16\""))
        assertTrue(light.contains("#6C707E"))
        assertTrue(dark.contains("#CED0D6"))
        assertEquals(light.replace("#6C707E", "GLYPH"), dark.replace("#CED0D6", "GLYPH"))
    }

    fun `test editor identity excludes mutable workspace name and branch metadata`() {
        val dto = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_1"), name = "Custom", branch = "feature/cloud")
        assertEquals(
            mapOf("provider" to "cloud", "workspace" to "wrk_1"),
            hostedWorkspaceParams(dto),
        )
        assertEquals(
            hostedWorkspaceParams(dto),
            hostedWorkspaceParams(dto.copy(name = "Renamed", branch = "feature/renamed")),
        )
    }

    fun `test editor metadata cache is bounded and readable off the EDT`() {
        val cache = HostedWorkspaceCache()
        repeat(257) { index ->
            cache.put(HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_$index"), name = "Workspace $index"))
        }
        val first = java.util.concurrent.CompletableFuture.supplyAsync {
            cache.get(HostedWorkspaceRefDto("cloud", "wrk_0"))
        }.get()
        val latest = java.util.concurrent.CompletableFuture.supplyAsync {
            cache.get(HostedWorkspaceRefDto("cloud", "wrk_256"))
        }.get()
        assertNull(first)
        assertEquals("Workspace 256", latest?.name)
    }

    fun `test workspace has only a standard themed status badge and no cost or duplicate description`() {
        val sleeping = row("sleeping")
        assertEquals(listOf("cloud-compute"), sleeping.badges.map { it.id })
        assertEquals("Sleeping", sleeping.badges.single().text)
        assertSame(UiStyle.Badge.Secondary, sleeping.badges.single().style)
        assertFalse(sleeping.description.orEmpty().contains("sleeping"))
        val active = row("active")
        assertEquals("Active", active.badges.single().text)
        assertEquals(UiStyle.Badge.typeAgent(true), active.badges.single().style)
        assertEquals("Starting", row("starting").badges.single().text)
    }

    fun `test canonical compute states and sandbox aliases map to shared themed badges`() {
        val cases = mapOf(
            "active" to "Active", "running" to "Active", "setting_up" to "Setting Up",
            "sleeping" to "Sleeping", "starting" to "Starting", "stopping" to "Stopping",
            "stopped" to "Stopped", "error" to "Unavailable", "unreachable" to "Unavailable",
            "unknown" to "Unknown",
        )
        cases.forEach { (state, text) ->
            val row = row(state)
            assertEquals(text, row.badges.single().text)
            assertEquals(HostedWorkspaceStatus.of(row.data.status).badge(), row.badges.single())
        }
        val row = HostedWorkspaceRow(HostedWorkspaceRowData(row("active").data.dto, null))
        assertEquals("Loading Cloud status...", row.badges.single().text)
    }

    fun `test setup in progress reads as a grey Setting Up badge until the chat is ready`() {
        val settingUp = row("setting_up")
        assertEquals("Setting Up", settingUp.badges.single().text)
        assertSame(UiStyle.Badge.Secondary, settingUp.badges.single().style)
        val starting = row("starting")
        assertEquals("Starting", starting.badges.single().text)
        assertSame(UiStyle.Badge.Secondary, starting.badges.single().style)
    }

    fun `test active badge reuses the marketplace Agents green`() {
        val active = row("active").badges.single().style as UiStyle.Badge.Type
        val marketplace = UiStyle.Badge.typeAgent(true)
        assertEquals(marketplace.bg(), active.bg())
        assertEquals(marketplace.fg(), active.fg())
    }

    fun `test workspace busy and attention icons reuse local worktree indicators`() {
        val idle = row("active")
        val busy = HostedWorkspaceRow(idle.data.copy(kind = SessionActivityKind.RUNNING))
        assertSame(SpinnerIcon.icon, busy.icon)
        assertFalse(busy.tinted)
        assertSame(HostedWorkspaceIcons.cloud, idle.icon)
        val waiting = HostedWorkspaceRow(idle.data.copy(kind = SessionActivityKind.QUESTION))
        assertSame(WorktreeIcons.forRow(false, SessionActivityKind.QUESTION), waiting.icon)
        assertFalse(busy == idle)
    }

    fun `test workspace status badges follow the title rather than the trailing edge`() {
        val rows = listOf(row("sleeping", "Short"), row("running", "A longer Cloud workspace title"))
        val model = CollectionListModel<ActiveListItem>(rows)
        val list = JBList<ActiveListItem>(model)
        val renderer = ActiveListRenderer(model, ActiveListConfig(badgesRight = true))
        list.cellRenderer = renderer
        list.setSize(560, 180)
        val edges = rows.mapIndexed { index, row ->
            val cell = renderer.getListCellRendererComponent(list, row, index, false, true)
            cell.setSize(list.width, cell.preferredSize.height)
            activeListLayout(cell)
            val badge = descendants(cell).filterIsInstance<ActiveListBadgeCell>().single { it.cellId == "cloud-compute" }
            val title = rowTitle(cell)
            val pill = SwingUtilities.convertRectangle(badge.parent, badge.bounds, cell)
            val text = SwingUtilities.convertRectangle(title.parent, title.bounds, cell)
            assertTrue("Status must clear the title", pill.x >= text.x + text.width)
            assertTrue("Status stays next to the title: pill=$pill text=$text", pill.x - text.x - text.width <= UiStyle.Gap.lg())
            assertTrue("Status belongs on the title line", kotlin.math.abs(pill.centerY - text.centerY) <= 2)
            assertTrue(cell.bounds.contains(pill))
            pill.x + pill.width
        }
        assertTrue(edges.first() < edges.last())
    }

    private fun row(state: String, name: String = "Cloud workspace"): HostedWorkspaceRow {
        val ref = HostedWorkspaceRefDto("cloud", name.replace(' ', '_'))
        return HostedWorkspaceRow(HostedWorkspaceRowData(
            HostedWorkspaceDto(ref, name = name, branch = "main"),
            HostedWorkspaceStatusDto(ref, "active", state, "detail", 100.0, rateMicrodollarsPerHour = 1_000_000),
        ))
    }

    private fun descendants(root: Component): List<Component> = listOf(root) +
        if (root is Container) root.components.flatMap(::descendants) else emptyList()

    private fun svg(name: String): String =
        checkNotNull(HostedWorkspaceIcons::class.java.getResourceAsStream("/icons/$name.svg"))
            .use { it.readBytes().decodeToString() }
}
