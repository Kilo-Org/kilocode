package ai.kilocode.client.session.ui

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Container
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class QuestionPanelTest : BasePlatformTestCase() {

    private lateinit var parent: Disposable
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var workspace: Workspace
    private lateinit var controller: SessionController
    private lateinit var panel: QuestionPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("question-panel")
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        val sessions = KiloSessionService(project, scope, rpc)
        val appRpc = FakeAppRpcApi().also { it.state.value = KiloAppStateDto(KiloAppStatusDto.READY) }
        val workspaceRpc = FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        }
        app = KiloAppService(scope, appRpc)
        workspaces = KiloWorkspaceService(scope, workspaceRpc)
        workspace = workspaces.workspace("/test")
        val root = BorderLayoutPanel()
        controller = SessionController(parent, "ses_test", sessions, workspace, app, scope, root)
        panel = QuestionPanel(controller)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test empty question hides panel and clears stale request id`() {
        panel.show(
            Question(
                id = "req_old",
                items = listOf(
                    QuestionItem(
                        question = "Pick one",
                        header = "Header",
                        options = listOf(QuestionOption("Yes", "desc")),
                        multiple = false,
                        custom = true,
                    )
                ),
            )
        )
        assertTrue(panel.isVisible)

        panel.show(Question(id = "req_new", items = emptyList()))

        assertFalse(panel.isVisible)
        assertEquals(0, panel.componentCount)
        assertTrue(rpc.questionReplies.isEmpty())
        assertTrue(rpc.questionRejects.isEmpty())
    }

    fun `test dismiss button uses bundle text and rejects question`() {
        panel.show(
            Question(
                id = "req_1",
                items = listOf(
                    QuestionItem(
                        question = "Pick one",
                        header = "Header",
                        options = listOf(QuestionOption("Yes", "desc")),
                        multiple = false,
                        custom = true,
                    )
                ),
            )
        )

        val button = buttons(panel).first { it.text == "Dismiss" }
        button.doClick()
        flush()

        assertFalse(panel.isVisible)
        assertEquals("req_1", rpc.questionRejects.single().first)
    }

    private fun buttons(root: Container): List<JButton> = root.components.flatMap { comp ->
        val item = if (comp is JButton) listOf(comp) else emptyList()
        if (comp is Container) item + buttons(comp) else item
    }

    private fun flush() = runBlocking {
        repeat(5) {
            delay(100)
            ApplicationManager.getApplication().invokeAndWait {
                UIUtil.dispatchAllInvocationEvents()
            }
        }
    }
}
