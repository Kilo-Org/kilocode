package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloMcpAuthService
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.McpStatusDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

class SessionUiHostedMcpTest : SessionUiTestBase() {
    fun `test hosted session does not show local mcp auth issues`() {
        val rpc = FakeAgentBehaviorRpcApi().also {
            it.mcps = listOf(McpStatusDto("anaconda", "needs_auth"))
        }
        val auth = KiloMcpAuthService(scope, KiloAgentBehaviorService(scope, rpc))
        ApplicationManager.getApplication().replaceService(
            KiloMcpAuthService::class.java,
            auth,
            testRootDisposable,
        )
        runBlocking(Dispatchers.Default) { auth.refresh(workspace.directory) }
        assertTrue(auth.needsAuth.value[workspace.directory].orEmpty().contains("anaconda"))

        val manager = object : SessionManager {
            override val hosted = true
            override fun newSession() = Unit
            override fun showHistory(back: (() -> Unit)?) = Unit
            override fun openSession(ref: SessionRef) = Unit
        }
        ui = newUi("hosted:kilo-cloud:worktree_1:ses_one", manager = manager)
        layout()
        settle()

        assertTrue(find(ui, PromptPanel::class.java)!!.issuesForTest().isEmpty())
    }
}
