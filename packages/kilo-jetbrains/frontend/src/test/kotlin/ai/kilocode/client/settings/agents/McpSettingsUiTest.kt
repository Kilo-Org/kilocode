package ai.kilocode.client.settings.agents

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloMcpAuthService
import ai.kilocode.client.app.KiloMarketplaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DirectoryReadyConfigurable
import ai.kilocode.client.settings.base.SettingsInfo
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeMarketplaceRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.client.testing.rowLines
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.client.ui.list.activeListHits
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.McpAuthResultDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.MarketplaceBundleDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.SwingUtilities
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class McpSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: McpSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private lateinit var marketRpc: FakeMarketplaceRpcApi

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            ui?.let { panel -> edt { panel.dispose(); true } }
            ui = null
            scope?.cancel()
            scope = null
        } finally {
            super.tearDown()
        }
    }

    fun `test page shows exactly one info banner explaining mcp servers`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val info = components(panel).filterIsInstance<SettingsInfo>().single()
            assertEquals(KiloBundle.message("settings.agentBehavior.mcp.info"), bannerIntro(info))
            true
        }
    }

    fun `test loads configured mcp servers with runtime status`() {
        val panel = panel()

        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            assertEquals(listOf("filesystem", "github", "runtime"), rows.map { it.key })
            assertEquals(listOf("connected", "stdio"), rows.single { it.key == "filesystem" }.badges.map { it.text })
            assertEquals("bun mcp-files", rows.single { it.key == "filesystem" }.description)
            assertEquals(listOf("needs auth", "remote"), rows.single { it.key == "github" }.badges.map { it.text })
            assertEquals(AllIcons.General.Warning, rows.single { it.key == "github" }.badges.first().icon)
            assertEquals("https://mcp.github.test", rows.single { it.key == "github" }.description)
            assertEquals(listOf("failed"), rows.single { it.key == "runtime" }.badges.map { it.text })
            assertEquals("crashed", rows.single { it.key == "runtime" }.description)
            val github = rows.single { it.key == "github" }
            assertEquals(listOf("auth", "edit", "remove"), github.cells.map { it.id })
            assertTrue(github.cells.single { it.id == "edit" }.primary)
            val remove = github.cells.single { it.id == "remove" }
            assertEquals(AllIcons.Actions.GC, remove.icon)
            assertTrue(remove.iconOnly)
            val filesystem = rows.single { it.key == "filesystem" }
            assertEquals(listOf("disconnect", "edit", "remove"), filesystem.cells.map { it.id })
            assertTrue(filesystem.cells.single { it.id == "edit" }.primary)
            assertEquals(KiloBundle.message("settings.agentBehavior.mcp.disconnect"), filesystem.cells.single { it.id == "disconnect" }.label)
            assertFalse(rows.single { it.key == "runtime" }.cells.any { it.id == "edit" })
            assertFalse(rows.single { it.key == "runtime" }.cells.any { it.id == "remove" })
            assertEquals(listOf(DIR), agentRpc.mcpCalls)
            true
        }
    }

    fun `test predefined search filters to one MCP server`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            panel.filter("github")
            assertEquals(listOf("github"), rows(panel).map { it.key })
            true
        }
    }

    fun `test a server needing auth offers sign in`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            // github is needs_auth in the fixture; the row must expose sign-in, not just Connect.
            val cells = rows(panel).single { it.key == "github" }.cells.map { it.id }
            assertTrue("needs_auth must offer sign-in, got $cells", cells.contains("auth"))
            assertFalse("needs_auth must not offer connect, got $cells", cells.contains("connect"))
            assertFalse("needs_auth must not offer reset sign-in, got $cells", cells.contains("resetAuth"))
            val label = rows(panel).single { it.key == "github" }.cells.single { it.id == "auth" }.label
            assertEquals(KiloBundle.message("settings.agentBehavior.mcp.signIn"), label)
            // A healthy server must not.
            assertFalse(rows(panel).single { it.key == "filesystem" }.cells.any { it.id == "auth" })
            true
        }
    }

    fun `test failed status badge carries the failure reason as its tooltip`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val badge = rows(panel).single { it.key == "runtime" }.badges.first()
            assertEquals("failed", badge.text)
            val tooltip = badge.tooltip
            assertNotNull("the failed badge must explain itself", tooltip)
            assertTrue("tooltip should carry the reason, got $tooltip", tooltip!!.contains("crashed"))
            assertTrue("tooltip should name the status, got $tooltip", tooltip.contains("failed"))
            true
        }
    }

    fun `test healthy status badge has no tooltip`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            // The pill already reads "connected"; a tooltip repeating it would be noise.
            assertNull(rows(panel).single { it.key == "filesystem" }.badges.first().tooltip)
            true
        }
    }

    fun `test failure reason is reachable through list hit testing`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = list(panel)
            list.size = Dimension(460, 260)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == "runtime" }
            list.selectedIndex = idx
            // Proves the badge is hit-tested, so hovering it actually shows the reason rather than
            // the text merely existing on the model.
            val hit = activeListHits(list, idx, selected = true).single { it.id == "status" }
            assertTrue("hovering the badge must reveal the reason", hit.tooltip.orEmpty().contains("crashed"))
            true
        }
    }

    fun `test mcp rows keep equal height`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = list(panel)
            list.size = Dimension(460, 260)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val heights = rows(panel).indices.map { idx -> list.getCellBounds(idx, idx).height }.toSet()

            assertEquals(1, heights.size)
            assertTrue(list.fixedCellHeight > 0)
        }
    }

    fun `test mcp renderer hides synthesized descriptions`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = list(panel)
            val rows = rows(panel)
            val idx = rows.indexOfFirst { it.key == "filesystem" }
            val row = rows[idx]
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, idx, true, true)
            comp.setSize(460, list.fixedCellHeight)
            layout(comp)
            val (title, desc) = rowLines(comp)
            val action = components(comp).filterIsInstance<JBLabel>().single { it.text == "Disconnect" }

            assertEquals("bun mcp-files", row.description)
            assertFalse(desc.isVisible)
            assertEquals("", desc.toString())
            assertTrue(kotlin.math.abs(centerY(comp, title) - centerY(comp, action)) <= 1)
        }
    }

    fun `test refresh reloads latest mcp status`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        agentRpc.mcps = listOf(McpStatusDto("filesystem", "disabled"))
        edt { panel.reload(); true }

        flushUntil { rows(panel).single { it.key == "filesystem" }.badges.first().text == "disabled" }
        assertEquals(listOf(DIR, DIR), agentRpc.mcpCalls)
    }

    fun `test panel reloads automatically when it becomes visible again`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        val calls = agentRpc.mcpCalls.size
        val host = JPanel()

        edt {
            host.add(panel)
            host.addNotify()
            true
        }
        try {
            edt { host.removeNotify(); true }
            assertEquals(calls, agentRpc.mcpCalls.size)

            edt { host.addNotify(); true }

            flushUntil { agentRpc.mcpCalls.size > calls }
        } finally {
            edt { host.removeNotify(); true }
        }
    }

    fun `test connect action updates runtime status and keeps selection`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.afterMcpConnect = { _, name ->
            agentRpc.mcps = agentRpc.mcps.filterNot { it.name == name } + McpStatusDto(name, "connected")
        }

        click(panel, "runtime", "connect")

        flushUntil { rows(panel).single { it.key == "runtime" }.badges.first().text == "connected" }
        assertEquals(listOf("runtime"), agentRpc.mcpConnects)
        assertEquals("runtime", edt { list(panel).selectedValue?.key })
    }

    fun `test remove action writes mcp config patch and reloads`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcps = agentRpc.mcps.filterNot { it.name == "filesystem" }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(panel, "filesystem", "remove")

        flushUntil { rows(panel).none { it.key == "filesystem" } }
        val save = agentRpc.mcpSaves.single()
        assertEquals("filesystem", save.first)
        assertEquals("global", save.second)
        assertNull(save.third)
    }

    fun `test removing a marketplace MCP confirms and removes its companion bundle`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        val server = agentRpc.mcpConfigs.getValue("github")
        agentRpc.mcpConfigs = agentRpc.mcpConfigs + ("github" to server.copy(scope = "workspace"))
        marketRpc.bundles = listOf(MarketplaceBundleDto("github", "project", listOf("$DIR/.kilo/skills/github/SKILL.md")))
        edt { panel.reload(); true }
        flushUntil { marketRpc.bundleCalls.size >= 2 && searchField(panel).isEnabled }
        var message = ""
        TestDialogManager.setTestDialog {
            message = it
            Messages.YES
        }

        click(panel, "github", "remove")

        flushUntil { marketRpc.removeCalls.isNotEmpty() }
        assertTrue(message.contains("companion skills"))
        assertEquals(FakeMarketplaceRpcApi.RemoveCall(DIR, "github", "mcp", "project"), marketRpc.removeCalls.single())
        assertTrue(agentRpc.mcpSaves.isEmpty())
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test declining marketplace MCP removal keeps both components`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        marketRpc.bundles = listOf(MarketplaceBundleDto("github", "global", listOf("/skills/github/SKILL.md")))
        edt { panel.reload(); true }
        flushUntil { marketRpc.bundleCalls.size >= 2 && searchField(panel).isEnabled }
        TestDialogManager.setTestDialog { Messages.NO }

        click(panel, "github", "remove")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(marketRpc.removeCalls.isEmpty())
        assertTrue(agentRpc.mcpSaves.isEmpty())
    }

    fun `test remove selects the server that took the deleted slot`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcps = agentRpc.mcps.filterNot { it.name == "filesystem" }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(panel, "filesystem", "remove")

        flushUntil { rows(panel).none { it.key == "filesystem" } }
        assertEquals("github", edt { list(panel).selectedValue?.key })
    }

    fun `test edit keeps the edited server selected when the reload reorders rows`() {
        val next = McpConfigDto(type = "local", command = listOf("bun", "new-server"))
        val panel = panel { name, cfg -> FakeEditDialog(name, cfg, next) }
        flushUntil { rows(panel).size == 3 }
        // Sorts above the edited server, so the reload shifts every row down one slot.
        agentRpc.mcps = agentRpc.mcps + McpStatusDto("alpha", "failed")

        click(panel, "filesystem", "edit")

        flushUntil { rows(panel).size == 4 }
        assertEquals("filesystem", edt { list(panel).selectedValue?.key })
    }

    fun `test remove action requires confirmation`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(panel, "filesystem", "remove")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(agentRpc.mcpSaves.isEmpty())
        assertTrue(edt { rows(panel).any { it.key == "filesystem" } })
    }

    fun `test edit action writes mcp config patch and reloads`() {
        val next = McpConfigDto(
            type = "local",
            command = listOf("bun", "new-server"),
            environment = mapOf("TOKEN" to "y"),
            headers = mapOf("X-Keep" to "1"),
            enabled = false,
            timeout = 10000L,
        )
        val panel = panel { name, cfg -> FakeEditDialog(name, cfg, next) }
        flushUntil { rows(panel).size == 3 }

        click(panel, "filesystem", "edit")

        flushUntil { rows(panel).single { it.key == "filesystem" }.description == "bun new-server" }
        val save = agentRpc.mcpSaves.single()
        assertEquals("filesystem", save.first)
        assertEquals("global", save.second)
        assertEquals(next, save.third)
        assertEquals("filesystem", edt { list(panel).selectedValue?.key })
    }

    fun `test edit action preserves env vars after save reload and re edit`() {
        val seen = mutableListOf<McpConfigDto>()
        val next = McpConfigDto(
            type = "local",
            command = listOf("bun", "new-server"),
            environment = mapOf("TOKEN" to "y", "NEXT" to "value"),
        )
        val panel = panel { name, cfg ->
            seen += cfg
            FakeEditDialog(name, cfg, next)
        }
        flushUntil { rows(panel).size == 3 }

        click(panel, "filesystem", "edit")
        flushUntil { rows(panel).single { it.key == "filesystem" }.description == "bun new-server" }
        click(panel, "filesystem", "edit")
        flushUntil { seen.size == 2 && agentRpc.mcpSaves.size == 2 }

        assertEquals(mapOf("TOKEN" to "x"), seen[0].environment)
        assertEquals(mapOf("TOKEN" to "y", "NEXT" to "value"), seen[1].environment)
        assertEquals(next, agentRpc.mcpSaves.last().third)
    }

    fun `test edit workspace scoped server saves to workspace scope`() {
        val next = McpConfigDto(type = "local", command = listOf("node", "p.js"))
        install()
        agentRpc.mcpConfigs = agentRpc.mcpConfigs +
            ("project" to McpServerConfigDto(McpConfigDto(type = "local", command = listOf("node", "s.js")), "workspace"))
        agentRpc.mcps = agentRpc.mcps + McpStatusDto("project", "disabled")
        val panel = edt { McpSettingsUi(scope!!, DIR) { name, cfg -> FakeEditDialog(name, cfg, next) } }
        ui = panel
        edt { panel.reload(); true }
        flushUntil { rows(panel).any { it.key == "project" } }

        click(panel, "project", "edit")

        flushUntil { agentRpc.mcpSaves.isNotEmpty() }
        val save = agentRpc.mcpSaves.single()
        assertEquals("project", save.first)
        assertEquals("workspace", save.second)
        assertEquals(next, save.third)
    }

    fun `test double click configured server opens edit`() {
        val next = McpConfigDto(type = "remote", url = "https://updated.example.test")
        val panel = panel { name, cfg -> FakeEditDialog(name, cfg, next) }
        flushUntil { rows(panel).size == 3 }

        doubleClick(panel, "github")

        flushUntil { rows(panel).single { it.key == "github" }.description == "https://updated.example.test" }
        val save = agentRpc.mcpSaves.single()
        assertEquals("github", save.first)
        assertEquals("global", save.second)
        assertEquals(next, save.third)
    }

    fun `test toolbar add hint is visible`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            assertTrue(text(panel).contains(KiloBundle.message("settings.agentBehavior.mcp.addHint")))
            true
        }
    }

    fun `test toolbar offers marketplace as final button after separator`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            assertMarketplaceToolbarButton(panel)
            true
        }
    }

    fun `test failed mcp action shows settings error`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcpConnectResult = false

        click(panel, "runtime", "connect")

        val message = KiloBundle.message("settings.agentBehavior.mcp.action.failed")
        flushUntil { text(panel).contains(message) }
        assertTrue(edt { rows(panel).any { it.key == "runtime" } })
    }

    fun `test sign in success reconnects and clears the auth cell`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcpAuthenticateResult = McpAuthResultDto("connected")

        click(panel, "github", "auth")
        // The fake authenticate call succeeds instantly; the ensuing reload picks up a status that
        // the test flips to connected, mirroring what a real reconnect would report.
        agentRpc.mcps = agentRpc.mcps.filterNot { it.name == "github" } + McpStatusDto("github", "connected")

        flushUntil { rows(panel).single { it.key == "github" }.badges.first().text == "connected" }
        assertEquals(listOf("github"), agentRpc.mcpAuthentications)
    }

    fun `test sign in failure shows the CLI error`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcpAuthenticateResult = McpAuthResultDto("failed", "denied by server")

        click(panel, "github", "auth")

        flushUntil { text(panel).contains("denied by server") }
        assertTrue(edt { rows(panel).any { it.key == "github" } })
    }

    fun `test sign in cancel calls mcpAuthRemove`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.mcpAuthRemoveResult = true

        edt {
            // Directly exercises the cancel path the progress overlay's Cancel button wires to,
            // since driving the real overlay button requires a longer-lived in-flight sign-in.
            scope!!.launch { service<KiloMcpAuthService>().cancel(DIR, "github") }
            true
        }

        flushUntil { agentRpc.mcpAuthRemovals.contains("github") }
    }

    fun `test reset sign in cell only appears for connected remote servers`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            assertFalse(rows.single { it.key == "github" }.cells.any { it.id == "resetAuth" })
            assertFalse(rows.single { it.key == "filesystem" }.cells.any { it.id == "resetAuth" })
            true
        }

        status(panel, "github", "connected")

        edt {
            val cells = rows(panel).single { it.key == "github" }.cells.map { it.id }
            assertEquals(listOf("disconnect", "resetAuth", "edit", "remove"), cells)
            true
        }
    }

    fun `test reset sign in requires confirmation and calls mcpAuthRemove on accept`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        status(panel, "github", "connected")
        agentRpc.mcpAuthRemoveResult = true
        agentRpc.afterMcpConnect = { _, name ->
            agentRpc.mcps = agentRpc.mcps.filterNot { it.name == name } + McpStatusDto(name, "needs_auth")
        }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(panel, "github", "resetAuth")

        flushUntil { service<KiloMcpAuthService>().needsAuth.value[DIR].orEmpty().contains("github") }
        assertEquals(listOf("github"), agentRpc.mcpAuthRemovals)
        assertEquals(listOf("github"), agentRpc.mcpDisconnects)
        assertEquals(listOf("github"), agentRpc.mcpConnects)
    }

    fun `test reset sign in decline does not call mcpAuthRemove`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        status(panel, "github", "connected")
        TestDialogManager.setTestDialog { Messages.NO }

        click(panel, "github", "resetAuth")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(agentRpc.mcpAuthRemovals.isEmpty())
    }

    fun `test missing directory still shows configured mcp servers`() {
        install()
        val panel = edt { McpSettingsUi(scope!!, "") }
        ui = panel
        edt { panel.reload(); true }

        flushUntil { rows(panel).size == 2 }

        edt {
            assertEquals(listOf("filesystem", "github"), rows(panel).map { it.key })
            assertTrue(agentRpc.mcpCalls.isEmpty())
            true
        }
    }

    fun `test configurable lifecycle triggers initial list load`() {
        install()
        val cfg = TestConfigurable()

        val shell = edt { cfg.createComponent() }

        flushUntil { components(shell).filterIsInstance<McpSettingsUi>().singleOrNull()?.let { rows(it).size == 3 } == true }
        ui = components(shell).filterIsInstance<McpSettingsUi>().single()
        assertEquals(listOf(DIR), agentRpc.mcpCalls)
        edt { cfg.disposeUIResources(); true }
    }

    fun `test configurable disposal disposes the mcp settings panel`() {
        install()
        // Hold the status call so the panel is provably still busy when the dialog closes. Only
        // SettingsListPanel.dispose() clears that busy state; cancelling the configurable scope
        // leaves the search field disabled, so this fails unless the override delegates to
        // DraftReadyConfigurableBase.
        val gate = CompletableDeferred<Unit>()
        agentRpc.mcpStatusGate = gate
        val cfg = McpConfigurable()
        val shell = edt { cfg.createComponent() }
        flushUntil { components(shell).filterIsInstance<McpSettingsUi>().singleOrNull() != null }
        val panel = components(shell).filterIsInstance<McpSettingsUi>().single()
        ui = panel
        flushUntil { agentRpc.mcpCalls.isNotEmpty() && !searchField(panel).isEnabled }

        edt { cfg.disposeUIResources(); true }
        gate.complete(Unit)

        assertTrue("dispose() must clear the busy state", edt { searchField(panel).isEnabled })
    }

    private fun panel(create: (String, McpConfigDto) -> McpEditDialogHandle = ::McpEditDialog): McpSettingsUi {
        install()
        val panel = edt { McpSettingsUi(scope!!, DIR, create) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun status(panel: McpSettingsUi, name: String, status: String) {
        val calls = agentRpc.mcpCalls.size
        agentRpc.mcps = agentRpc.mcps.filterNot { it.name == name } + McpStatusDto(name, status)
        edt { panel.reload(); true }
        flushUntil { agentRpc.mcpCalls.size > calls && searchField(panel).isEnabled }
    }

    private fun install() {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        marketRpc = FakeMarketplaceRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            mcps = listOf(
                McpStatusDto("filesystem", "connected"),
                McpStatusDto("github", "needs_auth"),
                McpStatusDto("runtime", "failed", "crashed"),
            )
            mcpConfigs = mapOf(
                "filesystem" to McpServerConfigDto(McpConfigDto(type = "stdio", command = listOf("bun", "mcp-files"), environment = mapOf("TOKEN" to "x")), "global"),
                "github" to McpServerConfigDto(
                    McpConfigDto(type = "remote", url = "https://mcp.github.test", headers = mapOf("Authorization" to "Bearer token"), enabled = true, timeout = 5000L),
                    "global",
                ),
            )
        }
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        val behavior = KiloAgentBehaviorService(cs, agentRpc)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, behavior, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloMcpAuthService::class.java, KiloMcpAuthService(cs, behavior), testRootDisposable)
        ApplicationManager.getApplication().replaceService(
            KiloMarketplaceService::class.java,
            KiloMarketplaceService(cs, marketRpc),
            testRootDisposable,
        )
    }

    private fun click(panel: McpSettingsUi, key: String, id: String) {
        edt {
            val list = list(panel)
            list.size = Dimension(460, 260)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = activeListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
            true
        }
    }

    private fun doubleClick(panel: McpSettingsUi, key: String) {
        edt {
            val list = list(panel)
            list.size = Dimension(460, 260)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val bounds = list.getCellBounds(idx, idx)
            val point = Point(bounds.x + 10, bounds.y + bounds.height / 2)
            fire(list, mouse(list, MouseEvent.MOUSE_CLICKED, point, count = 2))
            true
        }
    }

    private fun rows(panel: McpSettingsUi): List<ActiveListItem> {
        val model = list(panel).model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun list(panel: McpSettingsUi) = components(panel).filterIsInstance<JBList<ActiveListItem>>().single()

    private fun bannerIntro(info: SettingsInfo): String {
        val pane = UIUtil.findComponentOfType(info, javax.swing.JEditorPane::class.java) ?: error("no banner text")
        return pane.text.replace(Regex("<[^>]+>"), "").replace(Regex("\\s+"), " ").trim()
    }

    private fun searchField(panel: McpSettingsUi): SearchTextField =
        components(panel).filterIsInstance<SearchTextField>().single()

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun layout(root: java.awt.Component) {
        root.doLayout()
        if (root is Container) root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun centerY(root: java.awt.Component, child: java.awt.Component): Int {
        val point = SwingUtilities.convertPoint(child.parent, child.location, root)
        return point.y + child.height / 2
    }

    private fun text(root: Container): String {
        val out = mutableListOf<String>()
        for (comp in components(root)) {
            if (!comp.isVisible) continue
            when (comp) {
                is JButton -> comp.text?.let { out.add(it) }
                is JBLabel -> comp.text?.let { out.add(it) }
                is JTextField -> comp.text?.let { out.add(it) }
            }
        }
        return out.joinToString("\n")
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(list: JBList<ActiveListItem>, point: Point) {
        fire(list, mouse(list, MouseEvent.MOUSE_PRESSED, point))
        fire(list, mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(list: JBList<ActiveListItem>, id: Int, point: Point, count: Int = 1) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        count,
        false,
        MouseEvent.BUTTON1,
    )

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(300) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents(); true }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(done())
    }

    private companion object {
        const val DIR = "/test"
    }

    private class TestConfigurable : DirectoryReadyConfigurable<JComponent>() {
        override fun getId() = "test.mcp"
        override fun getDisplayName() = "test"
        override fun create(cs: CoroutineScope, dir: String): JComponent = McpSettingsUi(cs, DIR)
    }
}

private class FakeEditDialog(
    val name: String,
    val cfg: McpConfigDto,
    private val next: McpConfigDto,
) : McpEditDialogHandle {
    override fun showAndGet() = true

    override fun result() = next
}
