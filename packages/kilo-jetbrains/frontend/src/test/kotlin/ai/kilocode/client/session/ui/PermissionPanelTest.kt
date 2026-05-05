package ai.kilocode.client.session.ui

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.update.SessionController
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
import javax.swing.AbstractButton

@Suppress("UnstableApiUsage")
class PermissionPanelTest : BasePlatformTestCase() {

    private lateinit var parent: Disposable
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var workspace: Workspace
    private lateinit var controller: SessionController
    private lateinit var panel: PermissionPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("permission-panel")
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        val sessions = KiloSessionService(project, scope, rpc)
        val api = FakeAppRpcApi().also { it.state.value = KiloAppStateDto(KiloAppStatusDto.READY) }
        val work = FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(status = KiloWorkspaceStatusDto.READY)
        }
        app = KiloAppService(scope, api)
        workspaces = KiloWorkspaceService(scope, work)
        workspace = workspaces.workspace("/test")
        controller = SessionController(parent, "ses_test", sessions, workspace, app, scope, BorderLayoutPanel())
        panel = PermissionPanel(controller)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test allow button uses bundle text and replies once`() {
        panel.show(permission())

        buttons(panel).first { it.text == "Allow" }.doClick()
        flush()

        assertFalse(panel.isVisible)
        assertEquals("perm1", rpc.permissionReplies.single().first)
        assertEquals("once", rpc.permissionReplies.single().third.reply)
    }

    fun `test deny button uses bundle text and rejects`() {
        panel.show(permission())

        buttons(panel).first { it.text == "Deny" }.doClick()
        flush()

        assertFalse(panel.isVisible)
        assertEquals("perm1", rpc.permissionReplies.single().first)
        assertEquals("reject", rpc.permissionReplies.single().third.reply)
    }

    private fun permission() = Permission(
        id = "perm1",
        sessionId = "ses_test",
        name = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        meta = PermissionMeta(),
        message = "Review file changes",
    )

    private fun buttons(root: Container): List<AbstractButton> = root.components.flatMap { comp ->
        val item = if (comp is AbstractButton) listOf(comp) else emptyList()
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
