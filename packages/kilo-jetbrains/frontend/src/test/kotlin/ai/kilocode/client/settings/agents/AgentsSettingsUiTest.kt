package ai.kilocode.client.settings.agents

import ai.kilocode.client.util.edtWait
import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.settings.base.SettingsInfo
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.LightVirtualFile
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
import javax.swing.JComboBox
import javax.swing.JTextField
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class AgentsSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: AgentsSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private val picked = mutableListOf<Pair<String?, List<String>>>()

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

    fun `test page shows exactly one info banner explaining agents`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            val info = components(panel).filterIsInstance<SettingsInfo>().single()
            assertEquals(KiloBundle.message("settings.agentBehavior.agents.info"), bannerIntro(info))
            true
        }
    }

    fun `test loads agents from cli`() {
        val panel = panel()

        flushUntil { rows(panel).size == 6 }

        edt {
            val rows = rows(panel)
            assertEquals(listOf("ask", "code", "generated", "hidden", "old", "worker"), rows.map { it.key })
            assertEquals("Configured code", rows.single { it.key == "code" }.description)
            assertEquals(listOf("subagent"), rows.single { it.key == "generated" }.badges.map { it.text })
            assertEquals(listOf("custom", "hidden"), rows.single { it.key == "hidden" }.badges.map { it.text })
            assertEquals(listOf("custom", "deprecated"), rows.single { it.key == "old" }.badges.map { it.text })
            assertEquals(listOf("custom", "subagent"), rows.single { it.key == "worker" }.badges.map { it.text }.sorted())
            assertFalse(rows.single { it.key == "ask" }.cells.any { it.id == DELETE_CELL })
            assertFalse(rows.single { it.key == "generated" }.cells.any { it.id == DELETE_CELL })
            assertTrue(rows.single { it.key == "hidden" }.cells.any { it.id == DELETE_CELL })
            assertEquals("code", picker(panel).selectedItem)
            assertEquals(listOf("", "ask", "code", "old"), comboItems(picker(panel)))
        }
    }

    /**
     * The model cell has to be last on both a deletable and a non-deletable row: it is the only cell
     * an unselected row shows, so anything ordered after it would shift it sideways on selection.
     */
    fun `test agent rows pin the assigned model to the last cell`() {
        val panel = panel(model = MODEL)
        flushUntil { rows(panel).size == 6 }

        edt {
            val code = rows(panel).single { it.key == "code" }
            assertEquals(listOf(EDIT_CELL, MODEL_CELL), code.cells.map { it.id })
            assertEquals("GPT-5", code.cells.last().label)
            assertTrue(code.cells.last().alwaysVisible)
            val hidden = rows(panel).single { it.key == "hidden" }
            assertEquals(listOf(EDIT_CELL, DELETE_CELL, MODEL_CELL), hidden.cells.map { it.id })
            assertEquals("Default model", hidden.cells.last().label)
            assertEquals(
                KiloBundle.message("settings.agentBehavior.agents.model.default"),
                hidden.cells.last().label,
            )
            true
        }
    }

    fun `test choosing a model from the row dropdown stages the override`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt { clickCell(panel, "code", MODEL_CELL); true }

        edt {
            assertEquals(listOf(null to listOf(MODEL, "kilo/sonnet")), picked)
            val row = rows(panel).single { it.key == "code" }
            assertEquals("GPT-5", row.cells.single { it.id == MODEL_CELL }.label)
            assertTrue(row.badges.any { it.text == "not applied" })
            assertTrue(panel.modified())
            panel.applyDraft()
            true
        }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        assertEquals(MODEL, appRpc.configPatches.single().agents.getValue("code").model)
    }

    fun `test clearing the row dropdown stages removal of the override`() {
        val panel = panel(choice = null, model = MODEL)
        flushUntil { rows(panel).size == 6 }

        edt { clickCell(panel, "code", MODEL_CELL); true }

        edt {
            assertEquals(listOf(MODEL to listOf(MODEL, "kilo/sonnet")), picked)
            val row = rows(panel).single { it.key == "code" }
            assertEquals(KiloBundle.message("settings.agentBehavior.agents.model.default"), row.cells.single { it.id == MODEL_CELL }.label)
            assertTrue(panel.modified())
            panel.applyDraft()
            true
        }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        val patch = appRpc.configPatches.single().agents.getValue("code")
        assertNull(patch.model)
        assertTrue(patch.clear.contains("model"))
    }

    /**
     * Saving config can bounce the CLI, so the post-apply re-read can fail. It used to fall back to an
     * empty agent list, which blanked the whole settings list and the default-agent picker until the
     * user hit refresh.
     */
    fun `test apply keeps the rows when the agent re-read fails`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }
        edt { clickCell(panel, "code", MODEL_CELL); true }
        assertTrue(edt { staged(panel) })

        agentRpc.agentsError = RuntimeException("connection reset")
        edt { panel.applyDraft(); true }
        // The staged badge clears inside the post-apply EDT update, so this waits for that update
        // rather than for `modified()`, which already reads false while the save is in flight.
        flushUntil { appRpc.configPatches.isNotEmpty() && !edt { staged(panel) } }

        edt {
            assertEquals(listOf(DIR, DIR), agentRpc.agentCalls)
            assertEquals(6, rows(panel).size)
            assertEquals("GPT-5", rows(panel).single { it.key == "code" }.cells.single { it.id == MODEL_CELL }.label)
            assertEquals(listOf("", "ask", "code", "old"), comboItems(picker(panel)))
            assertEquals("code", picker(panel).selectedItem)
            true
        }
    }

    /** An empty re-read is always a failed read: the built-in agents are never absent. */
    fun `test apply keeps the rows when the agent re-read comes back empty`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }
        edt { clickCell(panel, "code", MODEL_CELL); true }
        assertTrue(edt { staged(panel) })

        agentRpc.agents = emptyList()
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() && !edt { staged(panel) } }

        edt {
            assertEquals(6, rows(panel).size)
            assertEquals("GPT-5", rows(panel).single { it.key == "code" }.cells.single { it.id == MODEL_CELL }.label)
            true
        }
    }

    fun `test double click opens the agent edit dialog`() {
        val seen = mutableListOf<String>()
        val panel = panel(edit = { agent, items ->
            seen += agent.name
            assertEquals(listOf(MODEL, "kilo/sonnet"), items.map { it.key })
            FakeAgentEditDialog(agent, agent.copy(prompt = "Edited"))
        })
        flushUntil { rows(panel).size == 6 }

        edt {
            assertEquals(EDIT_CELL, rows(panel).single { it.key == "code" }.doubleClick)
            doubleClick(panel, "code")
            true
        }

        assertEquals(listOf("code"), seen)
        assertTrue(edt { panel.modified() })
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        assertEquals("Edited", appRpc.configPatches.single().agents.getValue("code").prompt)
    }

    fun `test staged rows do not open the edit dialog on double click`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        val panel = panel(create = { FakeCreateDialog(input) }, edit = { _, _ -> error("edit must not open") })
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            assertNull(rows(panel).single { it.key == "reviewer" }.doubleClick)
            doubleClick(panel, "reviewer")
            assertFalse(rows(panel).any { it.key == "reviewer" })
            true
        }
    }

    fun `test agent rows keep equal height`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            val list = list(panel)
            list.size = Dimension(420, 260)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val heights = rows(panel).indices.map { idx -> list.getCellBounds(idx, idx).height }.toSet()

            assertEquals(1, heights.size)
            assertTrue(list.fixedCellHeight > 0)
        }
    }

    fun `test toolbar offers marketplace as final button after separator`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            assertMarketplaceToolbarButton(panel)
            true
        }
    }

    fun `test changing default agent saves patch`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt { picker(panel).selectedItem = "ask"; true }
        assertTrue(edt { panel.modified() })
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        assertEquals("ask", appRpc.configPatches.single().values[KiloCliParser.CONFIG_DEFAULT_AGENT])
        flushUntil { !edt { panel.modified() } }
    }

    fun `test reset reverts unsaved default agent change`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            picker(panel).selectedItem = "ask"
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(panel.modified())
            assertEquals("code", picker(panel).selectedItem)
            true
        }
    }

    fun `test adding an agent stages it until apply and supports undo`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        var names = emptyList<String>()
        val panel = panel(create = { existing ->
            names = existing.toList()
            FakeCreateDialog(input)
        })
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            true
        }

        edt {
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals(listOf("ask", "code", "generated", "hidden", "old", "worker"), names.sorted())
            assertTrue(agentRpc.creations.isEmpty())
            assertTrue(panel.modified())
            assertEquals("Reviews code", row.description)
            assertEquals("reviewer", list(panel).selectedValue?.key)
            assertEquals(listOf("not applied", "custom"), row.badges.map { it.text })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            clickCell(panel, "reviewer", UNDO_CELL)
            assertFalse(panel.modified())
            assertFalse(rows(panel).any { it.key == "reviewer" })
            true
        }
    }

    fun `test applying staged create commits and reloads`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        val panel = panel(create = { FakeCreateDialog(input) })
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            panel.applyDraft()
            true
        }
        flushUntil { agentRpc.creations.isNotEmpty() && !edt { panel.modified() } }

        assertEquals(listOf(input), agentRpc.creations)
        assertEquals(listOf(DIR), agentRpc.createDirs)
        assertTrue(edt { rows(panel).any { it.key == "reviewer" } })
    }

    /**
     * The re-read fallback is the pre-write list, so it cannot contain an agent this apply just
     * created. Losing that write would hide a row for an agent whose file was in fact written.
     */
    fun `test apply keeps a newly created agent whose re-read fails`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        val panel = panel(create = { FakeCreateDialog(input) })
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            agentRpc.agentsError = RuntimeException("connection reset")
            panel.applyDraft()
            true
        }
        // Apply clears its busy flag only after the state and rows are updated, so `idle` means the
        // whole apply has settled rather than just that the write reached the CLI.
        flushUntil { agentRpc.creations.isNotEmpty() && idle(panel) }

        edt {
            assertEquals(listOf(input), agentRpc.creations)
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals("Reviews code", row.description)
            true
        }
    }

    fun `test apply keeps a newly imported agent whose re-read comes back empty`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.ImportAction().perform(file("reviewer.agent.json", """
                {
                    "name": "reviewer",
                    "description": "Reviews code",
                    "prompt": "Review carefully",
                    "mode": "subagent"
                }
            """.trimIndent()))
            true
        }
        // Importing is asynchronous and `applyDraft` no-ops while the panel is busy, so wait for it to
        // settle before applying. The empty re-read is then set up so the apply hits that path.
        flushUntil { rows(panel).any { it.key == "reviewer" } && idle(panel) }

        edt {
            agentRpc.agents = emptyList()
            panel.applyDraft()
            true
        }
        flushUntil { appRpc.configPatches.isNotEmpty() && idle(panel) }

        edt {
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals("Reviews code", row.description)
            true
        }
    }

    fun `test apply waits for backend ready before refetching`() {
        val loading = CompletableDeferred<Unit>()
        val panel = panel()
        flushUntil { rows(panel).size == 6 }
        appRpc.afterConfig = {
            app._state.value = app._state.value.copy(status = KiloAppStatusDto.LOADING)
            loading.complete(Unit)
        }

        edt {
            picker(panel).selectedItem = "ask"
            panel.applyDraft()
            true
        }
        runBlocking { loading.await() }
        edt { UIUtil.dispatchAllInvocationEvents(); true }

        assertEquals(listOf(DIR), agentRpc.agentCalls)
        assertTrue(edt { text(panel).contains(KiloBundle.message("settings.agentBehavior.saving")) })

        app._state.value = app._state.value.copy(status = KiloAppStatusDto.READY)
        flushUntil { agentRpc.agentCalls.size == 2 && !edt { panel.modified() } }
    }

    fun `test importing an agent stages patch until apply`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.ImportAction().perform(file("reviewer.agent.json", """
                {
                    "name": "reviewer",
                    "description": "Reviews code",
                    "prompt": "Review carefully",
                    "mode": "subagent",
                    "permission": {
                        "bash": {
                            "*": "deny",
                            "uname": "allow"
                        },
                        "edit": "ask"
                    }
                }
            """.trimIndent()))
            true
        }
        flushUntil { rows(panel).any { it.key == "reviewer" } }

        edt {
            assertTrue(appRpc.configPatches.isEmpty())
            assertTrue(panel.modified())
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals("Reviews code", row.description)
            assertEquals("reviewer", list(panel).selectedValue?.key)
            assertTrue(row.badges.any { it.text == "not applied" })
            assertTrue(row.badges.any { it.text == "subagent" })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            true
        }

        appRpc.afterConfig = { patch ->
            if (patch.agents.containsKey("reviewer")) {
                agentRpc.agents = agentRpc.agents + AgentDetailDto(
                    "reviewer",
                    description = "Reviews code",
                    mode = KiloCliParser.MODE_SUBAGENT,
                    native = false,
                    removable = true,
                )
            }
        }
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() && !edt { panel.modified() } }

        edt {
            val patch = appRpc.configPatches.single().agents.getValue("reviewer")
            assertEquals("Reviews code", patch.description)
            assertEquals("Review carefully", patch.prompt)
            assertEquals(KiloCliParser.MODE_SUBAGENT, patch.mode)
            assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "deny", "uname" to "allow")), patch.permission?.get("bash"))
            assertEquals(PermissionRuleDto.Level("ask"), patch.permission?.get("edit"))
            true
        }
    }

    fun `test importing invalid JSON shows settings error message`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.ImportAction().perform(file("bad.agent.json", "{"))
            true
        }
        val message = KiloBundle.message("settings.agentBehavior.agents.import.invalidJson")
        flushUntil { text(panel).contains(message) }

        assertTrue(appRpc.configPatches.isEmpty())
        assertFalse(edt { text(panel).contains("AgentImportException") })
    }

    fun `test deleting custom agent stages removal and supports undo`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            val list = list(panel)
            list.size = Dimension(420, 260)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == "hidden" }
            list.selectedIndex = idx
            val area = activeListCellBounds(list, idx, selected = true).getValue(DELETE_CELL)
            click(list, center(area))
            true
        }

        edt {
            val row = rows(panel).single { it.key == "hidden" }
            assertTrue(panel.modified())
            assertTrue(agentRpc.removals.isEmpty())
            assertTrue(row.badges.any { it.text == "will be removed" })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            clickCell(panel, "hidden", UNDO_CELL)
            assertFalse(panel.modified())
            assertTrue(rows(panel).single { it.key == "hidden" }.cells.any { it.id == DELETE_CELL })
            true
        }
    }

    fun `test composite apply calls endpoints in order`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val order = mutableListOf<String>()
        val panel = panel(create = { FakeCreateDialog(input) })
        flushUntil { rows(panel).size == 6 }
        agentRpc.afterRemove = { _, name -> order += "remove:$name" }
        agentRpc.afterCreate = { _, item -> order += "create:${item.name}" }
        appRpc.afterConfig = { patch ->
            order += "config:${patch.agents.keys.sorted().joinToString("+")}:${patch.values.keys.sorted().joinToString("+")}"
            if (patch.agents.containsKey("imported")) {
                agentRpc.agents = agentRpc.agents + AgentDetailDto(
                    "imported",
                    description = "Imported",
                    mode = KiloCliParser.MODE_SUBAGENT,
                    native = false,
                    removable = true,
                )
            }
        }

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.ImportAction().perform(file("imported.agent.json", """
                { "name": "imported", "description": "Imported", "prompt": "Import", "mode": "subagent" }
            """.trimIndent()))
            picker(panel).selectedItem = "ask"
            true
        }
        flushUntil { rows(panel).any { it.key == "imported" } }
        edt { panel.applyDraft(); true }
        flushUntil { !edt { panel.modified() } }

        assertEquals(listOf(
            "remove:hidden",
            "create:creator",
            "config:imported:",
            "config::default_agent",
        ), order)
    }

    fun `test apply failure reloads and keeps remaining staged changes`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val panel = panel(create = { FakeCreateDialog(input) })
        flushUntil { rows(panel).size == 6 }
        agentRpc.createError = RuntimeException("boom")

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.applyDraft()
            true
        }
        flushUntil { text(panel).contains(KiloBundle.message("settings.agentBehavior.agents.create.failed")) }

        edt {
            assertEquals(listOf("hidden"), agentRpc.removals)
            assertFalse(rows(panel).any { it.key == "hidden" })
            val row = rows(panel).single { it.key == "creator" }
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            assertTrue(panel.modified())
            true
        }
    }

    fun `test refresh preserves staged intents`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val panel = panel(create = { FakeCreateDialog(input) })
        flushUntil { rows(panel).size == 6 }

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.reload()
            true
        }
        flushUntil { agentRpc.agentCalls.size >= 2 }

        edt {
            assertTrue(rows(panel).single { it.key == "hidden" }.badges.any { it.text == "will be removed" })
            assertEquals(listOf(UNDO_CELL), rows(panel).single { it.key == "creator" }.cells.map { it.id })
            assertTrue(panel.modified())
            true
        }
    }

    private fun panel(
        create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog,
        choice: String? = MODEL,
        model: String? = null,
        edit: (AgentEditDraft, List<ModelPicker.Item>) -> AgentEditDialogHandle = { agent, _ -> FakeAgentEditDialog(agent) },
    ): AgentsSettingsUi {
        install(model)
        val pick = AgentModelPicker { _, _, items, selected, choose ->
            picked += selected to items.map { it.key }
            choose(choice)
            null
        }
        val panel = edt { AgentsSettingsUi(scope!!, DIR, create, pick = pick, edit = edit) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install(model: String? = null) {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            agents = listOf(
                AgentDetailDto("ask", displayName = "Ask", description = "Ask questions", mode = KiloCliParser.MODE_PRIMARY, native = true),
                AgentDetailDto("code", displayName = "Code", description = "Code things", mode = KiloCliParser.MODE_PRIMARY, native = true),
                AgentDetailDto("generated", description = "Generated", mode = KiloCliParser.MODE_SUBAGENT, native = false, removable = false),
                AgentDetailDto("hidden", description = "Hidden custom", mode = KiloCliParser.MODE_PRIMARY, native = false, removable = true, hidden = true),
                AgentDetailDto("old", description = "Old custom", mode = KiloCliParser.MODE_PRIMARY, native = false, removable = true, deprecated = true),
                AgentDetailDto("worker", description = "Worker", mode = KiloCliParser.MODE_SUBAGENT, native = false, removable = true),
            )
        }
        val workspaceRpc = FakeWorkspaceRpcApi().apply { models = ModelsWorkspaceDto(providers()) }
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                defaultAgent = "code",
                agent = mapOf("code" to AgentConfigDto(description = "Configured code", model = model)),
            ),
        )
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(cs, workspaceRpc), testRootDisposable)
    }

    private fun providers() = ProvidersDto(
        providers = listOf(ProviderDto("kilo", "Kilo", models = mapOf(
            "gpt-5" to ModelDto("gpt-5", "GPT-5", recommendedIndex = 1.0),
            "sonnet" to ModelDto("sonnet", "Sonnet 4.6"),
        ))),
        connected = listOf("kilo"),
        defaults = emptyMap(),
    )

    private fun rows(panel: AgentsSettingsUi): List<ActiveListItem> {
        val model = list(panel).model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun list(panel: AgentsSettingsUi) = components(panel).filterIsInstance<JBList<ActiveListItem>>().single()

    /** The panel disables its search field while a request is in flight. */
    private fun idle(panel: AgentsSettingsUi) =
        components(panel).filterIsInstance<SearchTextField>().single().isEnabled

    private fun staged(panel: AgentsSettingsUi) =
        rows(panel).any { row -> row.badges.any { it.text == "not applied" } }

    private fun picker(panel: AgentsSettingsUi) = components(panel).filterIsInstance<JComboBox<String>>().single()

    private fun comboItems(box: JComboBox<String>) = (0 until box.itemCount).map { box.getItemAt(it) }

    private fun bannerIntro(info: SettingsInfo): String {
        val pane = UIUtil.findComponentOfType(info, javax.swing.JEditorPane::class.java) ?: error("no banner text")
        return pane.text.replace(Regex("<[^>]+>"), "").replace(Regex("\\s+"), " ").trim()
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

    private fun clickCell(panel: AgentsSettingsUi, key: String, cell: String) {
        val list = list(panel)
        list.size = Dimension(420, 260)
        list.doLayout()
        val idx = rows(panel).indexOfFirst { it.key == key }
        list.selectedIndex = idx
        val area = activeListCellBounds(list, idx, selected = true).getValue(cell)
        click(list, center(area))
    }

    private fun doubleClick(panel: AgentsSettingsUi, key: String) {
        val list = list(panel)
        list.size = Dimension(420, 260)
        list.doLayout()
        val idx = rows(panel).indexOfFirst { it.key == key }
        list.selectedIndex = idx
        val area = list.getCellBounds(idx, idx)
        // Left of the right-aligned action cells: a double-click landing on a cell is ignored.
        val point = Point(area.x + 2, area.y + area.height / 2)
        fire(list, mouse(list, MouseEvent.MOUSE_CLICKED, point, count = 2))
    }

    private fun file(name: String, text: String) = LightVirtualFile(name, text)
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
        const val MODEL = "kilo/gpt-5"
        const val MODEL_CELL = "model"
        const val EDIT_CELL = "edit"
        const val DELETE_CELL = "delete"
        const val UNDO_CELL = "undo"
    }
}

private class FakeCreateDialog(private val input: AgentCreateDto) : AgentCreateDialogHandle {
    override fun showAndGet() = true

    override fun result() = input
}

private class FakeAgentEditDialog(
    agent: AgentEditDraft,
    private val next: AgentEditDraft = agent,
) : AgentEditDialogHandle {
    override fun showAndGet() = true

    override fun result() = next
}
