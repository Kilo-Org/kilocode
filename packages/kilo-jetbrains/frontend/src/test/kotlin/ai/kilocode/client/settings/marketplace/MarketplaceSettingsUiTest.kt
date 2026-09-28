package ai.kilocode.client.settings.marketplace

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloMarketplaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DirectoryReadyConfigurable
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeMarketplaceRpcApi
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.util.edtWait
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceResultDto
import ai.kilocode.rpc.dto.MarketplaceSkillDto
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBList
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import java.awt.BorderLayout
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.text.JTextComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class MarketplaceSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: MarketplaceSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var marketRpc: FakeMarketplaceRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private var opened: MutableList<String> = mutableListOf()

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

    fun `test loads items sectioned and badged by installed state`() {
        val panel = panel()

        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            assertEquals(listOf("agent:planner", "mcp:context7", "skill:review-skill"), rows.map { it.key })
            assertEquals(listOf("Agents", "MCP Servers", "Skills"), rows.map { it.section })

            val planner = rows.single { it.key == "agent:planner" }
            assertEquals(
                listOf("Agent", KiloBundle.message("settings.marketplace.badge.installedProject"), "agents"),
                planner.badges.map { it.text },
            )
            assertEquals(listOf("install", "removeProject"), planner.cells.map { it.id })

            val context7 = rows.single { it.key == "mcp:context7" }
            assertEquals(
                listOf("MCP Server", KiloBundle.message("settings.marketplace.badge.installedGlobal"), "tools"),
                context7.badges.map { it.text },
            )
            assertEquals(listOf("install", "removeGlobal", "docs"), context7.cells.map { it.id })

            val skill = rows.single { it.key == "skill:review-skill" }
            assertEquals(listOf("Skill", "skills"), skill.badges.map { it.text })
            assertEquals(listOf("install", "docs"), skill.cells.map { it.id })
            true
        }
    }

    fun `test clicking a type chip narrows rows without refetching`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        clickChip(panel, MCP)

        assertEquals(listOf("agent:planner", "skill:review-skill"), edt { rows(panel).map { it.key } })
        assertEquals(1, marketRpc.listCalls.size)
    }

    fun `test clicking multiple type chips narrows to only the remaining types`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        clickChip(panel, AGENT)
        clickChip(panel, SKILL)

        assertEquals(listOf("mcp:context7"), edt { rows(panel).map { it.key } })
    }

    fun `test clicking All resets narrowed types back to everything`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        clickChip(panel, MCP)
        assertEquals(2, edt { rows(panel).size })

        clickAll(panel)

        assertEquals(3, edt { rows(panel).size })
        assertTrue(edt { chip(panel, MCP).selected })
    }

    fun `test clicking All when every type is already selected does not toggle any chip off`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        clickAll(panel)

        assertEquals(3, edt { rows(panel).size })
        assertTrue(edt { chip(panel, AGENT).selected })
        assertTrue(edt { chip(panel, MCP).selected })
        assertTrue(edt { chip(panel, SKILL).selected })
    }

    fun `test All types is a plain text action, not a tag or a link`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val button = allButton(panel)
            assertNull("All types must not carry a filled badge", button.presentation.icon)
            assertFalse("All types must not paint a background", button.isOpaque)
            assertEquals("All types uses ordinary label text, not link blue", UIUtil.getLabelForeground(), button.foreground)
            assertTrue(components(panel).filterIsInstance<FilterChip>().none { it.label == ALL })
            assertTrue(components(panel).filterIsInstance<ActionLink>().none { it.text == ALL })
            true
        }
    }

    fun `test All types hover box is the same size as the toolbar's own buttons`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val bar = refreshBar(panel)
            val row = generateSequence(bar.parent) { it.parent }
                .filterIsInstance<JComponent>()
                .first { it.layout is BorderLayout }
            row.setSize(row.preferredSize)
            layoutAll(row)

            val refresh = components(bar).filterIsInstance<ActionButton>().single()
            val all = allButton(panel)

            assertTrue("the refresh button must have real bounds to compare against", refresh.height > 0)
            assertEquals(
                "the text action must paint the same hover box as the toolbar icons",
                refresh.height,
                all.height,
            )
            assertTrue(
                "the row is taller than its buttons, so the button is genuinely not stretched (row ${row.height})",
                row.height > all.height,
            )
            true
        }
    }

    fun `test toolbar controls keep their own height instead of stretching to the row`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val bar = refreshBar(panel)
            val row = generateSequence(bar.parent) { it.parent }
                .filterIsInstance<JComponent>()
                .first { it.layout is BorderLayout }
            row.setSize(row.preferredSize.width, row.preferredSize.height + JBUI.scale(40))
            layoutAll(row)

            val controls = components(row).filter { it is JBCheckBox || it is FilterChip }
            assertEquals("expected both checkboxes and all three chips", 5, controls.size)
            for (c in controls) {
                assertTrue("${c.javaClass.simpleName} must have real bounds", c.height > 0)
                assertEquals(
                    "${c.javaClass.simpleName} must keep its own height, not the row's ${row.height}",
                    c.preferredSize.height,
                    c.height,
                )
            }
            true
        }
    }

    fun `test each row is tagged with its type in the same color as that type's chip`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            assertEquals(
                listOf("Agent", "MCP Server", "Skill"),
                rows.map { it.badges.first().text },
            )
            // the row tag matches the colour its filter chip shows when switched on
            assertEquals(badge(panel, AGENT).style, rows.single { it.key == "agent:planner" }.badges.first().style)
            assertEquals(badge(panel, MCP).style, rows.single { it.key == "mcp:context7" }.badges.first().style)
            assertEquals(badge(panel, SKILL).style, rows.single { it.key == "skill:review-skill" }.badges.first().style)
            true
        }
    }

    fun `test a long row description gives a wrapped tooltip rather than one endless line`() {
        marketRpc = FakeMarketplaceRpcApi().apply {
            list = MarketplaceListDto(items = listOf(items().first().copy(description = LONG_DESCRIPTION)))
        }
        val panel = panel(rpc = marketRpc)
        flushUntil { rows(panel).size == 1 }

        val tip = edt {
            val list = list(panel)
            list.size = Dimension(520, 320)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            list.getToolTipText(mouse(list, MouseEvent.MOUSE_MOVED, Point(bounds.x + 8, bounds.y + bounds.height - 4)))
        }

        assertNotNull("a row with a description should offer a tooltip", tip)
        assertTrue("the tooltip must be html", tip!!.startsWith("<html>"))
        assertTrue(
            "the tooltip must cap its line width instead of running off screen",
            tip.contains("width=\"${UiStyle.Text.tipWidth()}\""),
        )
        assertTrue("the tooltip still carries the description", tip.contains("Kafka clients"))
    }

    fun `test filter checkboxes explain themselves with wrapped multi-line tooltips`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            for (text in listOf(INSTALLED_ONLY, RELEVANT_ONLY)) {
                val tip = checkBox(panel, text).toolTipText
                assertNotNull("$text needs a tooltip", tip)
                assertTrue("$text tooltip must be html so it wraps", tip!!.startsWith("<html>"))
                assertTrue("$text tooltip must cap its line width", tip.contains("width=\"${UiStyle.Text.tipWidth()}\""))
            }
            assertTrue(
                "the installed tooltip should say which scopes count",
                checkBox(panel, INSTALLED_ONLY).toolTipText.contains("globally"),
            )
            assertTrue(
                "the relevant tooltip should explain the filename match",
                checkBox(panel, RELEVANT_ONLY).toolTipText.contains("filenames"),
            )
            true
        }
    }

    fun `test type chips fill with full color when on and fade when off`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        val on = edt { badge(panel, AGENT) }
        clickChip(panel, AGENT)
        val off = edt { badge(panel, AGENT) }

        assertEquals("an active chip is a full-strength fill", 255, on.style.bg().alpha)
        assertTrue("an inactive chip fades its fill back", off.style.bg().alpha < on.style.bg().alpha)
        assertEquals("toggling keeps the label", on.text, off.text)
    }

    fun `test toolbar keeps filters on the left, checkboxes on the right, and standard height`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val bar = refreshBar(panel)
            val row = generateSequence(bar.parent) { it.parent }
                .filterIsInstance<JComponent>()
                .first { it.layout is BorderLayout }
            val layout = row.layout as BorderLayout
            val west = layout.getLayoutComponent(BorderLayout.WEST) as JComponent
            val east = layout.getLayoutComponent(BorderLayout.EAST) as JComponent

            assertTrue("refresh shares the left edge with the filters", components(west).contains(bar))
            assertTrue(components(west).contains(allButton(panel)))
            assertEquals(
                listOf(AGENT, MCP, SKILL),
                components(west).filterIsInstance<FilterChip>().map { it.label },
            )
            assertEquals(
                listOf(INSTALLED_ONLY, RELEVANT_ONLY),
                components(east).filterIsInstance<JBCheckBox>().map { it.text },
            )
            assertTrue(components(west).filterIsInstance<JBCheckBox>().isEmpty())
            assertTrue("toolbar must report a real height", bar.preferredSize.height > 0)
            assertEquals(
                "toolbar extras must not make the row taller than the platform toolbar",
                bar.preferredSize.height,
                row.preferredSize.height,
            )
            true
        }
    }

    fun `test installed only filter narrows rows`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt { checkBox(panel, INSTALLED_ONLY).doClick(); true }

        assertEquals(setOf("agent:planner", "mcp:context7"), edt { rows(panel).map { it.key }.toSet() })
        assertEquals(1, marketRpc.listCalls.size)
    }

    fun `test relevant to workspace filter narrows rows`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt { checkBox(panel, RELEVANT_ONLY).doClick(); true }

        assertEquals(listOf("mcp:context7"), edt { rows(panel).map { it.key } })
        assertEquals(1, marketRpc.listCalls.size)
    }

    fun `test MCP install preserves companions and refreshes the Skills cache`() {
        val skills = listOf(MarketplaceSkillDto("docs-lookup", "https://example.com/docs-lookup.tar.gz"))
        val rpc = FakeMarketplaceRpcApi().apply {
            list = MarketplaceListDto(items = items().map { if (it.type == "mcp") it.copy(skills = skills) else it })
        }
        val panel = panel(rpc = rpc) { item, hasProjectDirectory ->
            assertTrue(hasProjectDirectory)
            assertEquals(skills, item.skills)
            FakeInstallDialog(MarketplaceInstallRequest("project", mapOf("apiKey" to "secret", "__method" to "npx")))
        }
        flushUntil { rows(panel).size == 3 }

        click(panel, "mcp:context7", "install")

        flushUntil { marketRpc.listCalls.size == 2 }
        val call = marketRpc.installCalls.single()
        assertEquals(DIR, call.directory)
        assertEquals("context7", call.item.id)
        assertEquals(skills, call.item.skills)
        assertEquals("project", call.target)
        assertEquals(mapOf("apiKey" to "secret", "__method" to "npx"), call.parameters)
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test switching the install dialog to an installed MCP scope removes and refreshes Skills`() {
        val panel = panel { item, directory ->
            val dialog = MarketplaceInstallDialog(item, directory)
            try {
                components(dialog.centerComponent()).filterIsInstance<ComboBox<*>>().first().selectedItem = "Global"
                assertTrue(text(dialog.centerComponent()).contains("companion skills owned"))
                FakeInstallDialog(dialog.result())
            } finally {
                dialog.close(DialogWrapper.CANCEL_EXIT_CODE)
            }
        }
        flushUntil { rows(panel).size == 3 }

        click(panel, "mcp:context7", "install")

        flushUntil { marketRpc.listCalls.size == 2 }
        assertTrue(marketRpc.installCalls.isEmpty())
        val call = marketRpc.removeCalls.single()
        assertEquals("context7", call.id)
        assertEquals("mcp", call.type)
        assertEquals("global", call.scope)
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test standalone skill install still refreshes the Skills cache`() {
        val panel = panel { _, _ -> FakeInstallDialog(MarketplaceInstallRequest("project", emptyMap())) }
        flushUntil { rows(panel).size == 3 }

        click(panel, "skill:review-skill", "install")

        flushUntil { marketRpc.listCalls.size == 2 }
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test the acting row reports progress in place of its buttons, then gets them back`() {
        val gate = CompletableDeferred<Unit>()
        marketRpc = FakeMarketplaceRpcApi().apply {
            list = MarketplaceListDto(items = items())
            installGate = gate
        }
        val panel = panel(rpc = marketRpc) { _, _ -> FakeInstallDialog(MarketplaceInstallRequest("global", emptyMap())) }
        flushUntil { rows(panel).size == 3 }

        click(panel, "mcp:context7", "install")
        flushUntil { marketRpc.installCalls.isNotEmpty() }

        edt {
            val acting = rows(panel).single { it.key == "mcp:context7" }
            assertEquals(KiloBundle.message("settings.marketplace.installing"), acting.progress)
            assertTrue("the row swaps its actions for the status text", acting.cells.isEmpty())
            val other = rows(panel).single { it.key == "agent:planner" }
            assertNull("other rows are untouched", other.progress)
            assertTrue(other.cells.isNotEmpty())
            true
        }

        gate.complete(Unit)
        flushUntil { rows(panel).single { it.key == "mcp:context7" }.progress == null }

        edt {
            assertTrue("the actions come back once the reload lands", rows(panel).all { it.cells.isNotEmpty() })
            true
        }
    }

    fun `test a failed action clears the row progress so its buttons return`() {
        val panel = panel { _, _ -> FakeInstallDialog(MarketplaceInstallRequest("project", emptyMap())) }
        flushUntil { rows(panel).size == 3 }
        marketRpc.installResult = MarketplaceResultDto(success = false, slug = "context7", error = "Nope.")

        click(panel, "mcp:context7", "install")

        flushUntil { text(panel).contains("Nope.") }
        assertTrue(agentRpc.skillReloads.isEmpty())
        edt {
            val row = rows(panel).single { it.key == "mcp:context7" }
            assertNull("a failure must not leave the row stuck on progress", row.progress)
            assertTrue(row.cells.isNotEmpty())
            true
        }
    }

    fun `test install surfaces a failed cli result as a settings error`() {
        val panel = panel { _, _ -> FakeInstallDialog(MarketplaceInstallRequest("project", emptyMap())) }
        flushUntil { rows(panel).size == 3 }
        marketRpc.installResult = MarketplaceResultDto(success = false, slug = "review-skill", error = "Skill already installed.")

        click(panel, "skill:review-skill", "install")

        flushUntil { text(panel).contains("Skill already installed.") }
        assertTrue(edt { rows(panel).any { it.key == "skill:review-skill" } })
    }

    fun `test cancelling the install dialog performs no install`() {
        val panel = panel { _, _ -> FakeInstallDialog(null) }
        flushUntil { rows(panel).size == 3 }

        click(panel, "mcp:context7", "install")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(marketRpc.installCalls.isEmpty())
    }

    fun `test remove requires confirmation then sends scope and reloads`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog(TestDialog.YES)
        marketRpc.list = MarketplaceListDto(items = items().map {
            if (it.id == "planner") it.copy(installedProject = false) else it
        })

        click(panel, "agent:planner", "removeProject")

        flushUntil { rows(panel).single { it.key == "agent:planner" }.cells.none { it.id == "removeProject" } }
        val call = marketRpc.removeCalls.single()
        assertEquals("planner", call.id)
        assertEquals("agent", call.type)
        assertEquals("project", call.scope)
        assertTrue("agent removal does not change skills", agentRpc.skillReloads.isEmpty())
    }

    fun `test MCP Remove confirms ownership without catalog companions then refreshes Skills`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        val notices = mutableListOf<String>()
        TestDialogManager.setTestDialog { text ->
            notices.add(text)
            Messages.YES
        }
        marketRpc.list = MarketplaceListDto(items = items().map {
            if (it.type == "mcp") it.copy(installedGlobal = false) else it
        })

        click(panel, "mcp:context7", "removeGlobal")

        flushUntil { rows(panel).single { it.key == "mcp:context7" }.cells.none { it.id == "removeGlobal" } }
        assertEquals(
            KiloBundle.message("settings.marketplace.remove.message", "Context7", "Global") +
                "\n\n" + KiloBundle.message("settings.marketplace.remove.skills"),
            notices.single(),
        )
        val call = marketRpc.removeCalls.single()
        assertEquals("context7", call.id)
        assertEquals("mcp", call.type)
        assertEquals("global", call.scope)
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test remove without confirmation performs no removal`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(panel, "mcp:context7", "removeGlobal")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(marketRpc.removeCalls.isEmpty())
        assertTrue(agentRpc.skillReloads.isEmpty())
    }

    fun `test docs cell opens the item link`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        click(panel, "mcp:context7", "docs")

        assertEquals(listOf("https://kilo.ai"), opened)
    }

    fun `test configurable lifecycle triggers initial list load`() {
        install(null)
        val cfg = TestConfigurable()

        val shell = edt { cfg.createComponent() }

        flushUntil {
            components(shell).filterIsInstance<MarketplaceSettingsUi>().singleOrNull()?.let { rows(it).size == 3 } == true
        }
        ui = components(shell).filterIsInstance<MarketplaceSettingsUi>().single()
        assertEquals(listOf(DIR), marketRpc.listCalls)
        edt { cfg.disposeUIResources(); true }
    }

    fun `test catalog errors show a banner without blanking the list`() {
        marketRpc = FakeMarketplaceRpcApi().apply {
            list = MarketplaceListDto(items = items(), errors = listOf("skills catalog unavailable"))
        }
        val panel = panel(rpc = marketRpc)
        flushUntil { rows(panel).size == 3 }

        edt {
            assertTrue(text(panel).contains("skills catalog unavailable"))
            true
        }
    }

    private fun items(): List<MarketplaceItemDto> = listOf(
        MarketplaceItemDto(
            id = "context7",
            type = "mcp",
            name = "Context7",
            description = "Docs lookup",
            category = "tools",
            author = "Kilo",
            authorUrl = "https://kilo.ai",
            url = "https://github.com/example/context7",
            content = "{}",
            installedProject = false,
            installedGlobal = true,
            relevant = true,
        ),
        MarketplaceItemDto(
            id = "planner",
            type = "agent",
            name = "Planner",
            description = "Plans work",
            category = "agents",
            content = "{}",
            installedProject = true,
            installedGlobal = false,
        ),
        MarketplaceItemDto(
            id = "review-skill",
            type = "skill",
            name = "Review Skill",
            description = "Reviews code",
            category = "skills",
            githubUrl = "https://github.com/example/review-skill",
            content = "\"https://example.com/review-skill.tar.gz\"",
            installedProject = false,
            installedGlobal = false,
        ),
    )

    private fun panel(
        rpc: FakeMarketplaceRpcApi? = null,
        create: (MarketplaceItemDto, Boolean) -> MarketplaceInstallDialogHandle = { _, _ -> FakeInstallDialog(null) },
    ): MarketplaceSettingsUi {
        install(rpc)
        val panel = edt { MarketplaceSettingsUi(scope!!, DIR, create) { url -> opened.add(url) } }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install(rpc: FakeMarketplaceRpcApi?) {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi()
        marketRpc = rpc ?: FakeMarketplaceRpcApi().apply { list = MarketplaceListDto(items = items()) }
        opened = mutableListOf()
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloMarketplaceService::class.java, KiloMarketplaceService(cs, marketRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
    }

    private fun click(panel: MarketplaceSettingsUi, key: String, id: String) {
        edt {
            val list = list(panel)
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = activeListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
            true
        }
    }

    private fun rows(panel: MarketplaceSettingsUi): List<ActiveListItem> {
        val model = list(panel).model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun list(panel: MarketplaceSettingsUi) = components(panel).filterIsInstance<JBList<ActiveListItem>>().single()

    private fun chip(panel: MarketplaceSettingsUi, label: String) =
        components(panel).filterIsInstance<FilterChip>().single { it.label == label }

    private fun badge(panel: MarketplaceSettingsUi, label: String) = chip(panel, label).icon as FilledBadgeIcon

    private fun clickChip(panel: MarketplaceSettingsUi, label: String) {
        edt {
            val c = chip(panel, label)
            c.dispatchEvent(mouse(c, MouseEvent.MOUSE_CLICKED, Point(1, 1)))
            true
        }
    }

    private fun allButton(panel: MarketplaceSettingsUi) =
        components(panel).filterIsInstance<ActionButtonWithText>().single { it.presentation.text == ALL }

    /** The toolbar holding the refresh action, as opposed to the one holding "All types". */
    private fun refreshBar(panel: MarketplaceSettingsUi) = components(panel)
        .filterIsInstance<ActionToolbar>()
        .map { it.component }
        .single { bar -> components(bar).filterIsInstance<ActionButtonWithText>().isEmpty() }

    private fun clickAll(panel: MarketplaceSettingsUi) {
        edt {
            allButton(panel).click()
            true
        }
    }

    private fun checkBox(panel: MarketplaceSettingsUi, text: String) =
        components(panel).filterIsInstance<JBCheckBox>().single { it.text == text }

    /** Lays out the whole subtree so nested Stack/Align wrappers assign their children real bounds. */
    private fun layoutAll(root: java.awt.Component) {
        if (root !is Container) return
        root.doLayout()
        root.components.forEach { layoutAll(it) }
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun text(root: Container): String {
        val out = mutableListOf<String>()
        for (comp in components(root)) {
            if (!comp.isVisible) continue
            when (comp) {
                is AbstractButton -> comp.text?.let { out.add(it) }
                is JLabel -> comp.text?.let { out.add(it) }
                is JTextComponent -> comp.text?.let { out.add(it) }
            }
        }
        return out.joinToString("\n")
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(list: JBList<ActiveListItem>, point: Point) {
        fire(list, mouse(list, MouseEvent.MOUSE_PRESSED, point))
        fire(list, mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(component: java.awt.Component, id: Int, point: Point, count: Int = 1) = MouseEvent(
        component,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        count,
        false,
        MouseEvent.BUTTON1,
    )

    /**
     * Dispatches the event already consumed.
     *
     * `ActiveListView`'s own handlers only test `UIUtil.isActionClick`, so they still run, but
     * `BasicListUI`'s handler skips consumed events — and its selection path calls
     * `Toolkit.getMenuShortcutKeyMaskEx()`, which throws `HeadlessException` on a headless CI runner
     * with no X display. Consuming keeps the cell activation under test while staying off that path.
     */
    private fun fire(component: java.awt.Component, event: MouseEvent) {
        event.consume()
        component.dispatchEvent(event)
    }

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
        const val LONG_DESCRIPTION =
            "Expert knowledge for Azure Event Hubs development including troubleshooting, best practices, " +
                "decision making, architecture and design patterns, limits and quotas, security, and " +
                "configuration when using Kafka clients/Streams, .NET SDK, Flink/Spark, geo-DR/replication, " +
                "or Auto Inflate scaling in Event Hubs, and other Azure Event Hubs related development tasks."
        val ALL = KiloBundle.message("settings.marketplace.type.all")
        val AGENT = KiloBundle.message("settings.marketplace.type.agent")
        val MCP = KiloBundle.message("settings.marketplace.type.mcp")
        val SKILL = KiloBundle.message("settings.marketplace.type.skill")
        val INSTALLED_ONLY = KiloBundle.message("settings.marketplace.installedOnly")
        val RELEVANT_ONLY = KiloBundle.message("settings.marketplace.relevantOnly")
    }

    private class TestConfigurable : DirectoryReadyConfigurable<JComponent>() {
        override fun getId() = "test.marketplace"
        override fun getDisplayName() = "test"
        override fun create(cs: CoroutineScope, dir: String): JComponent = MarketplaceSettingsUi(cs, DIR)
    }
}

private class FakeInstallDialog(private val request: MarketplaceInstallRequest?) : MarketplaceInstallDialogHandle {
    override fun showAndGet() = request != null
    override fun result() = request ?: error("dialog was cancelled")
}
