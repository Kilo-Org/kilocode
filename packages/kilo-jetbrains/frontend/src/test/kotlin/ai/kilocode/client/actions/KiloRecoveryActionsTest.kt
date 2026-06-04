package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow

@Suppress("UnstableApiUsage")
class KiloRecoveryActionsTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeWorkspaceRpcApi()
        ApplicationManager.getApplication().replaceService(
            KiloWorkspaceService::class.java,
            KiloWorkspaceService(scope, rpc),
            testRootDisposable,
        )
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test restart action stays enabled for all app states`() {
        val action = RestartKiloAction()
        val event = event(action)

        update(action, event)

        assertTrue("Restart should force-enable recovery action", event.presentation.isEnabled)
    }

    fun `test reinstall action stays enabled for all app states`() {
        val action = ReinstallKiloAction()
        val event = event(action)

        update(action, event)

        assertTrue("Reinstall should force-enable recovery action", event.presentation.isEnabled)
    }

    fun `test cli group has visible menu text`() {
        val xml = requireNotNull(javaClass.classLoader.getResourceAsStream("kilo.jetbrains.frontend.xml"))
            .bufferedReader()
            .use { it.readText() }

        assertTrue(xml.contains("<group id=\"Kilo.CliGroup\" text=\"CLI\" popup=\"true\">"))
        assertTrue(xml.contains("<reference ref=\"Kilo.Restart\"/>"))
        assertTrue(xml.contains("<reference ref=\"Kilo.Reinstall\"/>"))
        assertTrue(xml.contains("<group id=\"Kilo.OpenConfigGroup\" text=\"Config Files\" popup=\"true\">"))
        assertTrue(xml.contains("<reference ref=\"Kilo.OpenConfigGroup\"/>"))
        assertFalse(xml.contains("<action id=\"Kilo.ShowProfile\""))
        assertFalse(xml.contains("<reference ref=\"Kilo.ShowProfile\"/>"))
    }

    fun `test local config action says open when target exists`() {
        rpc.localConfigPath = "/test/.kilo/kilo.jsonc"
        rpc.localConfigDisplayPath = "~/.kilo/kilo.jsonc"
        rpc.localConfigExists = true
        service().localConfig["/test"] = ConfigTargetDto("/test/.kilo/kilo.jsonc", "~/.kilo/kilo.jsonc", true)
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Open: local ~/.kilo/kilo.jsonc", event.presentation.text)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test local config action says create when target is missing`() {
        rpc.localConfigPath = "/test/.kilo/kilo.jsonc"
        rpc.localConfigDisplayPath = "~/.kilo/kilo.jsonc"
        rpc.localConfigExists = false
        service().localConfig["/test"] = ConfigTargetDto("/test/.kilo/kilo.jsonc", "~/.kilo/kilo.jsonc", false)
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Create: local ~/.kilo/kilo.jsonc", event.presentation.text)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test global config action says open when target exists`() {
        rpc.globalConfigPath = "/config/kilo.jsonc"
        rpc.globalConfigDisplayPath = "~/.config/kilo/kilo.jsonc"
        rpc.globalConfigExists = true
        cacheGlobal(ConfigTargetDto("/config/kilo.jsonc", "~/.config/kilo/kilo.jsonc", true))
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Open: global ~/.config/kilo/kilo.jsonc", event.presentation.text)
        assertEquals(0, rpc.globalConfigPathCalls)
    }

    fun `test global config action says create when target is missing`() {
        rpc.globalConfigPath = "/config/kilo.jsonc"
        rpc.globalConfigDisplayPath = "~/.config/kilo/kilo.jsonc"
        rpc.globalConfigExists = false
        cacheGlobal(ConfigTargetDto("/config/kilo.jsonc", "~/.config/kilo/kilo.jsonc", false))
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Create: global ~/.config/kilo/kilo.jsonc", event.presentation.text)
        assertEquals(0, rpc.globalConfigPathCalls)
    }

    fun `test local config action disables without directory`() {
        val action = OpenLocalConfigAction()
        val event = event(action)

        update(action, event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    private fun event(action: AnAction, workspace: Workspace? = null): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        presentation.isEnabled = false
        return AnActionEvent.createFromDataContext("", presentation, context(workspace))
    }

    private fun update(action: AnAction, event: AnActionEvent) {
        ApplicationManager.getApplication().executeOnPooledThread {
            ActionUtil.updateAction(action, event)
        }.get()
    }

    private fun service(): KiloWorkspaceService = ApplicationManager.getApplication().getService(KiloWorkspaceService::class.java)

    private fun cacheGlobal(target: ConfigTargetDto) {
        val field = KiloWorkspaceService::class.java.getDeclaredField("globalConfig")
        field.isAccessible = true
        field.set(service(), target)
    }

    private fun context(workspace: Workspace?): DataContext {
        return DataContext { id ->
            when (id) {
                SessionManager.WORKSPACE_KEY.name -> workspace
                CommonDataKeys.PROJECT.name -> project.takeIf { workspace != null }
                else -> null
            }
        }
    }

    private fun workspace(dir: String): Workspace {
        return Workspace(
            dir,
            MutableStateFlow(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)),
            reload = {},
        )
    }
}
