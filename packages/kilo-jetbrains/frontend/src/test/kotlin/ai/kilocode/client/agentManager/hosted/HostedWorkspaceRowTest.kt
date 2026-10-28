package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.testing.rowTitle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadgeCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.activeListLayout
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBList
import java.awt.Component
import java.awt.Container
import javax.swing.SwingUtilities

class HostedWorkspaceRowTest : BasePlatformTestCase() {
    fun `test workspace has only a standard themed status badge and no cost or duplicate description`() {
        val sleeping = row("sleeping")
        assertEquals(listOf("cloud-compute"), sleeping.badges.map { it.id })
        assertEquals("Sleeping", sleeping.badges.single().text)
        assertSame(UiStyle.Badge.Secondary, sleeping.badges.single().style)
        assertFalse(sleeping.description.orEmpty().contains("sleeping"))
        val active = row("running")
        assertEquals("Active", active.badges.single().text)
        assertSame(UiStyle.Badge.ActivityRunning, active.badges.single().style)
        assertEquals("Starting", row("starting").badges.single().text)
    }

    fun `test workspace status badges share the title line trailing edge`() {
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
            assertTrue("Status belongs on the title line", kotlin.math.abs(pill.centerY - text.centerY) <= 2)
            assertTrue(cell.bounds.contains(pill))
            pill.x + pill.width
        }
        assertEquals(edges.first(), edges.last())
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
}
