package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
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
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container

class NewWorktreeDialogTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var sessionRpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private var dialog: NewWorktreeDialog? = null
    private val created = mutableListOf<Triple<String, String?, String>>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        app = KiloAppService(scope, FakeAppRpcApi())
        val ws = FakeWorkspaceRpcApi().apply { models = workspace() }
        workspaces = KiloWorkspaceService(scope, ws)
        sessionRpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, scope, sessionRpc)
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

    fun `test selecting a mode persists the agent for the workspace`() {
        open()
        flushUntil { edt { mode().selectedForTest() != null } }

        edt { mode().onSelect(ModePicker.Item("plan", "Plan")) }
        flushUntil { sessionRpc.configs.any { it.second.agent == "plan" } }

        assertTrue(sessionRpc.configs.any { it.first == "/test" && it.second.agent == "plan" })
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

    fun `test creating forwards the prompt and resolved branch`() {
        open()
        edt {
            prompt().setText("build the thing")
        }
        flushUntil { edt { prompt().isSendEnabled } }
        edt { prompt().send() }
        flushUntil { created.isNotEmpty() }
        dialog = null

        assertEquals(listOf(Triple("agent/foo", "main", "build the thing")), created)
    }

    private fun open() {
        dialog = edt {
            NewWorktreeDialog(
                JBPanel<Nothing>(),
                project,
                "/test",
                "agent/foo",
                "main",
                listOf("main"),
                onCreate = { branch, base, prompt -> created.add(Triple(branch, base, prompt)) },
                onImportPr = {},
                onImportBranch = {},
                app,
                workspaces,
                sessions,
            )
        }
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

    private fun prompt(): PromptPanel = descendants(root()).filterIsInstance<PromptPanel>().single()

    private fun root(): Component = requireNotNull(dialog).centerComponent()

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
