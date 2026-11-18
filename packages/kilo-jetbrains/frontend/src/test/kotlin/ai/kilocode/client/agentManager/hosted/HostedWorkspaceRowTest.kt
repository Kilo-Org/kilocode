package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.AgentManagerBadgeState
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerWorkspaceRow
import ai.kilocode.client.agentManager.LocalWorkspaceRowData
import ai.kilocode.client.testing.FakeAgentManagerFacade
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.active.ActiveBadgeCell
import ai.kilocode.client.ui.active.ActiveConfig
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.style
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeDto
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
            val row = row(HostedWorkspaceRowData(item, null))
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
        assertEquals("feature/cloud", row(HostedWorkspaceRowData(dto, null)).description)
        assertNull(row(HostedWorkspaceRowData(dto.copy(branch = null), null)).description)
        assertNull(row(HostedWorkspaceRowData(dto.copy(branch = " \t"), null)).description)
    }

    fun `test rows tabs and file types use the same cloud icon`() {
        val row = row("sleeping")
        val params = hostedWorkspaceParams(row.data.dto)
        assertSame(HostedWorkspaceIcons.cloud, row.icon)
        assertSame(row.icon, HostedWorkspaceEditorKind.icon(params))
        assertSame(row.icon, HostedWorkspaceFileType.getIcon())
    }

    fun `test deleting progress replaces the status badge with a spinner`() {
        val item = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_1"), name = "Cloud workspace")
        val row = row(HostedWorkspaceRowData(
            item,
            HostedWorkspaceStatusDto(item.ref, "active", "active", "sandbox_ready", 100.0),
            progress = "Deleting…",
        ))

        assertEquals("Deleting…", row.progress)
        assertSame(WorktreeIcons.spinner, row.icon)
        assertEmpty(row.badges)
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
            "failed" to "Failed",
            "stopped" to "Stopped", "error" to "Unavailable", "unreachable" to "Unavailable",
            "unknown" to "Unknown",
        )
        cases.forEach { (state, text) ->
            val row = row(state)
            assertEquals(text, row.badges.single().text)
            assertEquals(HostedWorkspaceStatus.of(row.data.status).badge(), row.badges.single())
        }
        val row = row(HostedWorkspaceRowData(row("active").data.dto, null))
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
        val busy = row(idle.data.copy(kind = SessionActivityKind.RUNNING))
        assertSame(SpinnerIcon.icon, busy.icon)
        assertFalse(busy.tinted)
        assertSame(HostedWorkspaceIcons.cloud, idle.icon)
        val waiting = row(idle.data.copy(kind = SessionActivityKind.QUESTION))
        assertSame(WorktreeIcons.forRow(false, SessionActivityKind.QUESTION), waiting.icon)
        assertFalse(busy == idle)
    }

    fun `test cloud verdict badges use the same trailing column regardless of title width`() {
        val cloud = listOf("Short", "A longer Cloud workspace title").map { name ->
            val item = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", name.replace(' ', '_')), name = name)
            row(HostedWorkspaceRowData(item, HostedWorkspaceStatusDto(item.ref, "active", "sleeping", "", 0.0)),
                pull(item.ref, GhState.OPEN))
        }
        val localDto = WorktreeDto("/repo/local", "Local", "feature/local", "/repo/local")
        val localPr = pull(HostedWorkspaceRefDto("local", "row"), GhState.OPEN).copy(path = localDto.path)
        val local = AgentManagerWorkspaceRow(LocalWorkspaceRowData(localDto, null, false, false, null),
            FakeAgentManagerFacade(AgentManagerBadgeState(pr = localPr)))
        val rows = listOf(local) + cloud
        assertTrue(rows.all { it.javaClass == AgentManagerWorkspaceRow::class.java })
        val model = CollectionListModel<ActiveItem>(rows)
        val list = JBList<ActiveItem>(model)
        val renderer = ActiveListRenderer(model, ActiveConfig(badgesRight = true))
        list.cellRenderer = renderer
        list.setSize(560, 180)
        val edges = rows.mapIndexed { index, row ->
            val cell = renderer.getListCellRendererComponent(list, row, index, false, true)
            cell.setSize(list.width, cell.preferredSize.height)
            activeLayout(cell)
            val badges = descendants(cell).filterIsInstance<ActiveBadgeCell>()
            val badge = badges.single { it.cellId == "pr-checks" }
            val pill = SwingUtilities.convertRectangle(badge.parent, badge.bounds, cell)
            badges.singleOrNull { it.cellId == "cloud-compute" }?.let { compute ->
                val computeBounds = SwingUtilities.convertRectangle(compute.parent, compute.bounds, cell)
                assertTrue("Compute status precedes PR verdicts", computeBounds.x + computeBounds.width <= pill.x)
            }
            assertTrue(cell.bounds.contains(pill))
            pill.x + pill.width
        }
        assertEquals(1, edges.toSet().size)
    }

    fun `test linked pull request adds the worktree verdict glyphs and number pill`() {
        val item = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_pr"), name = "Cloud PR", branch = "feature/pr")
        val row = row(HostedWorkspaceRowData(
            item,
            HostedWorkspaceStatusDto(item.ref, "active", "active", "sandbox_ready", 100.0),
        ), pull(item.ref, GhState.OPEN))

        assertEquals(listOf("cloud-compute", "pr-comments", "pr-review", "pr-checks"), row.badges.map { it.id })
        assertEquals("2", row.badges.single { it.id == "pr-comments" }.text)
        assertSame(PrIcons.reviewApproved, row.badges.single { it.id == "pr-review" }.icon)
        assertSame(PrIcons.checksPassed, row.badges.single { it.id == "pr-checks" }.icon)
        val pill = row.secondaryBadges.single()
        assertEquals("#42", pill.text)
        assertSame(style(GhState.OPEN), pill.style)
        assertTrue(row.search.contains("Fix Cloud PR"))
        assertTrue(row.search.contains("#42"))
    }

    fun `test no pull request keeps the compute badge and has no number pill`() {
        val row = row("active")
        assertEquals(listOf("cloud-compute"), row.badges.map { it.id })
        assertEmpty(row.secondaryBadges)
    }

    fun `test pull request badges do not depend on the selected sibling session`() {
        val item = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_pr"), name = "Cloud PR")
        val pr = pull(item.ref, GhState.DRAFT)
        val data = HostedWorkspaceRowData(item, null, kind = SessionActivityKind.RUNNING)
        val idle = row(data.copy(kind = null), pr)
        val busy = row(data, pr)

        assertEquals(idle.badges.map { it.id }, busy.badges.map { it.id })
        assertEquals(idle.secondaryBadges.map { it.text }, busy.secondaryBadges.map { it.text })
        assertSame(style(GhState.DRAFT), busy.secondaryBadges.single().style)
    }

    fun `test facade evidence and capabilities determine row badges without changing compute or metrics`() = edtWait {
        val item = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_pr"), name = "Cloud PR")
        val data = HostedWorkspaceRowData(item, HostedWorkspaceStatusDto(item.ref, "active", "sleeping", "", 0.0))
        val facade = FakeAgentManagerFacade(AgentManagerBadgeState(pr = pull(item.ref, GhState.OPEN)))
        val row = hostedWorkspaceRow(data, facade)
        assertEquals(AgentManagerElement.Cloud(item), row.element)
        assertEquals("Sleeping", row.badges.first().text)
        assertNull(row.badges.first().action)
        assertEquals(listOf("cloud-compute", "pr-comments", "pr-review", "pr-checks"), row.badges.map { it.id })
        assertTrue(row.badges.all { it.action == null })
        assertNull(row.secondaryBadges.single().action)
        assertNull(row.metrics)
        assertTrue(row.search.contains("Fix Cloud PR"))

        facade.state = facade.state.copy(enabled = setOf(AgentManagerCommand.PR))
        val enabled = hostedWorkspaceRow(data, facade)
        assertFalse(row == enabled)
        assertEquals(enabled, hostedWorkspaceRow(data, facade))
        assertEquals(enabled.hashCode(), hostedWorkspaceRow(data, facade).hashCode())
        assertNotNull(enabled.secondaryBadges.single().action)
        assertNull(row.secondaryBadges.single().action)

        facade.state = facade.state.copy(busy = true)
        val busy = hostedWorkspaceRow(data, facade)
        assertEmpty(busy.badges)
        assertEmpty(busy.secondaryBadges)
        assertFalse(enabled == busy)
    }

    private fun pull(ref: HostedWorkspaceRefDto, state: GhState) = WorktreePrDto(
        path = ref.key,
        number = 42,
        state = state,
        url = "https://github.com/owner/repo/pull/42",
        title = "Fix Cloud PR",
        review = GhReview.APPROVED,
        checks = GhChecksDto(GhChecks.PASSED, total = 3, passed = 3),
        comments = GhCommentsDto(total = 2, unresolved = 2),
        merge = GhMerge.CLEAN,
    )

    private fun row(state: String, name: String = "Cloud workspace"): AgentManagerWorkspaceRow<HostedWorkspaceRowData> {
        val ref = HostedWorkspaceRefDto("cloud", name.replace(' ', '_'))
        return row(HostedWorkspaceRowData(
            HostedWorkspaceDto(ref, name = name, branch = "main"),
            HostedWorkspaceStatusDto(ref, "active", state, "detail", 100.0, rateMicrodollarsPerHour = 1_000_000),
        ))
    }

    private fun row(data: HostedWorkspaceRowData, pr: WorktreePrDto? = null): AgentManagerWorkspaceRow<HostedWorkspaceRowData> = hostedWorkspaceRow(
        data,
        FakeAgentManagerFacade(AgentManagerBadgeState(
            pr = pr,
            busy = data.progress != null,
            enabled = AgentManagerCommand.entries.toSet(),
        )),
    )

    private fun descendants(root: Component): List<Component> = listOf(root) +
        if (root is Container) root.components.flatMap(::descendants) else emptyList()

    private fun svg(name: String): String =
        checkNotNull(HostedWorkspaceIcons::class.java.getResourceAsStream("/icons/$name.svg"))
            .use { it.readBytes().decodeToString() }
}
