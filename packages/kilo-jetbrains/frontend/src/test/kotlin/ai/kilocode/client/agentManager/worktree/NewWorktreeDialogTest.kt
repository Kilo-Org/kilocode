package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.TabInfo
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container
import java.awt.event.FocusEvent
import javax.swing.JTextField
import javax.swing.plaf.basic.BasicComboBoxUI
import javax.swing.plaf.basic.BasicComboPopup

class NewWorktreeDialogTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var sessionRpc: FakeSessionRpcApi
    private var dialog: NewWorktreeDialog? = null

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        app = KiloAppService(scope, FakeAppRpcApi())
        val ws = FakeWorkspaceRpcApi().apply { models = workspace() }
        workspaces = KiloWorkspaceService(scope, ws)
        sessionRpc = FakeSessionRpcApi()
    }

    override fun tearDown() {
        try {
            dialog?.let { d -> edt { Disposer.dispose(d.disposable) } }
            dialog = null
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test loads the default mode, model, and reasoning options`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }

        edt {
            assertEquals("build", mode().selectedForTest()?.id)
            assertEquals("kilo/gpt-5", model().selectionKeyForTest())
            assertTrue(reasoning().isVisible)
            assertEquals("low", reasoning().selectedForTest()?.id)
        }
    }

    fun `test selecting a mode forwards it with the created prompt and writes no global config`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }

        edt {
            mode().onSelect(ModePicker.Item("plan", "Plan"))
            prompt().setText("do it")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }

        assertEquals("plan", submitted().prompt?.agent)
        // Picking a mode must no longer mutate the global default_agent config.
        assertTrue(sessionRpc.configs.none { it.second.agent != null })
    }

    fun `test selecting a model persists it for the default agent`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }

        edt { model().onSelect(ModelPicker.Item("gpt-5", "GPT-5", "kilo", "Kilo", variants = listOf("low", "high"))) }

        assertEquals(ModelSelectionDto("kilo", "gpt-5"), app.models.value.model["build"])
    }

    fun `test selecting reasoning persists the variant for the current model`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }

        edt { reasoning().onSelect(ReasoningPicker.Item("high", "High")) }

        assertEquals("high", app.models.value.variant["kilo/gpt-5"])
    }

    fun `test creating forwards the prompt, resolved branch, and default selection`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }
        edt {
            prompt().setText("build the thing")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }

        val entry = submitted()
        assertEquals("agent/foo", entry.branch)
        assertEquals("main", entry.base)
        val payload = requireNotNull(entry.prompt)
        assertEquals("build the thing", payload.text)
        assertEquals("build", payload.agent)
        assertEquals("kilo", payload.provider)
        assertEquals("gpt-5", payload.model)
    }

    fun `test base branch fuzzy search selects matching popup item`() {
        open(branches = listOf("main", "release/candidate", "feature/refactor-ui"))

        edt { field().text = "relcan" }

        edt { assertEquals("release/candidate", popup().list.selectedValue) }
    }

    fun `test empty base branch restores default on focus lost`() {
        open()

        edt {
            val field = field()
            field.text = ""
            field.focusListeners.forEach { it.focusLost(FocusEvent(field, FocusEvent.FOCUS_LOST)) }

            assertEquals("main", field.text)
        }
    }

    fun `test base picker survives a dropped editor during layout`() {
        open()

        edt {
            val picker = combo() as BranchPicker
            val ui = picker.ui as BasicComboBoxUI
            ui.removeEditor()

            picker.preferredSize

            val comp = picker.editor.editorComponent
            assertTrue(picker.components.any { it === comp })
        }
    }

    fun `test creating with empty base branch falls back to default`() {
        open()
        flushUntil { edt { model().selectionKeyForTest() != null } }
        edt {
            field().text = ""
            prompt().setText("build the thing")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }

        assertEquals("main", submitted().base)
    }

    fun `test creating with fuzzy base branch uses matching branch`() {
        open(branches = listOf("main", "release/candidate", "feature/refactor-ui"))
        flushUntil { edt { model().selectionKeyForTest() != null } }
        edt {
            field().text = "relcan"
            prompt().setText("build the thing")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }

        assertEquals("release/candidate", submitted().base)
    }

    fun `test creating with unknown base branch does not create`() {
        open(branches = listOf("main", "release/candidate"))
        flushUntil { edt { model().selectionKeyForTest() != null } }
        edt {
            field().text = "zzzzzz"
            prompt().setText("build the thing")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }
        flush()

        assertNull(plan())
    }

    fun `test importing a pr url produces a pr plan`() {
        open()
        selectPr()
        edt {
            url().text = "https://github.com/o/r/pull/7"
            submit()
        }

        assertEquals(NewWorktreePlan.Pr("https://github.com/o/r/pull/7"), taken())
    }

    fun `test blank pr url does not import`() {
        open()
        selectPr()
        edt { submit() }

        assertNull(plan())
    }

    fun `test non-pr url does not import`() {
        open()
        selectPr()
        edt {
            url().text = "https://github.com/o/r/issues/7"
            submit()
        }

        assertNull(plan())
    }

    fun `test picking a branch produces a branch plan`() {
        open(branches = listOf("main", "feature/x"))
        selectBranch()
        edt {
            pickField().text = "feature/x"
            submit()
        }

        assertEquals(NewWorktreePlan.Branch("feature/x"), taken())
    }

    fun `test importing a fuzzy branch resolves to the real branch`() {
        open(branches = listOf("main", "feature/refactor-ui"))
        selectBranch()
        edt {
            pickField().text = "refui"
            submit()
        }

        assertEquals(NewWorktreePlan.Branch("feature/refactor-ui"), taken())
    }

    fun `test importing an unknown branch does not import`() {
        open(branches = listOf("main", "feature/x"))
        selectBranch()
        edt {
            pickField().text = "zzzzzz"
            submit()
        }

        assertNull(plan())
    }

    fun `test the new tab creates while the pr tab imports`() {
        open()

        edt { assertEquals(3, tabs().tabs.size) }
        selectPr()
        edt {
            url().text = "https://github.com/o/r/pull/7"
            submit()
        }

        assertEquals(NewWorktreePlan.Pr("https://github.com/o/r/pull/7"), taken())
    }

    fun `test the deselected tab stops painting`() {
        open()
        val fresh = newTab()

        selectPr()

        assertFalse(edt { fresh.isVisible })
        assertTrue(edt { prTab().isVisible })
    }

    fun `test reselecting a tab shows it again`() {
        open()
        selectPr()

        select(0)

        assertTrue(edt { newTab().isVisible })
        assertFalse(edt { prTab().isVisible })
    }

    fun `test an empty branch list disables the branch picker`() {
        open(branches = emptyList())
        selectBranch()

        edt {
            assertFalse(pick().isEnabled)
            submit()
        }

        assertNull(plan())
    }

    private fun open(branches: List<String> = listOf("main")) {
        dialog = edt {
            NewWorktreeDialog(
                JBPanel<Nothing>(),
                project,
                "/test",
                "agent/foo",
                "main",
                branches,
                app,
                workspaces,
            )
        }
    }

    private fun plan(): NewWorktreePlan? = edt { requireNotNull(dialog).result() }

    /** Reads the plan after a confirming submit, then forgets the dialog: closing already disposed it. */
    private fun taken(): NewWorktreePlan = requireNotNull(plan()).also { dialog = null }

    /** Waits for the dialog to accept a create, then forgets it: closing already disposed it. */
    private fun submitted(): NewWorktreePlan.Create {
        flushUntil { plan() != null }
        return (requireNotNull(plan()) as NewWorktreePlan.Create).also { dialog = null }
    }

    private fun workspace(): ModelsWorkspaceDto {
        val providers = ProvidersDto(
            providers = listOf(
                ProviderDto(
                    "kilo", "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto("gpt-5", "GPT-5", variants = listOf("low", "high")),
                        "opus" to ModelDto("opus", "Opus"),
                    ),
                ),
            ),
            connected = emptyList(),
            defaults = emptyMap(),
        )
        val agents = listOf(AgentDto("build", mode = "primary"), AgentDto("plan", mode = "primary"))
        return ModelsWorkspaceDto(providers, AgentsDto(agents, agents, "build"))
    }

    private fun mode(): ModePicker = prompt().mode

    private fun model(): ModelPicker = prompt().model

    private fun reasoning(): ReasoningPicker = prompt().reasoning

    private fun prompt(): PromptPanel = descendants(newTab()).filterIsInstance<PromptPanel>().single()

    private fun combo(): ComboBox<*> = descendants(newTab()).filterIsInstance<ComboBox<*>>().single()

    private fun field(): JTextField = combo().editor.editorComponent as JTextField

    private fun popup(): BasicComboPopup = combo().accessibleContext.getAccessibleChild(0) as BasicComboPopup

    private fun tabs(): JBTabs = requireNotNull(dialog).centerComponent() as JBTabs

    private fun newTab(): Component = tabs().tabs[0].component

    private fun prTab(): Component = tabs().tabs[1].component

    private fun branchTab(): Component = tabs().tabs[2].component

    private fun selectPr() = select(1)

    private fun selectBranch() = select(2)

    private fun select(index: Int) = edt {
        val info: TabInfo = tabs().tabs[index]
        tabs().select(info, false)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun url(): JBTextField = descendants(prTab()).filterIsInstance<JBTextField>().single()

    private fun pick(): ComboBox<*> = descendants(branchTab()).filterIsInstance<ComboBox<*>>().single()

    private fun pickField(): JTextField = pick().editor.editorComponent as JTextField

    private fun submit() = requireNotNull(dialog).submit()

    private fun descendants(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(c: Component) {
            out += c
            if (c is Container) c.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flush() = runBlocking {
        repeat(20) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(200) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue(done())
    }
}
