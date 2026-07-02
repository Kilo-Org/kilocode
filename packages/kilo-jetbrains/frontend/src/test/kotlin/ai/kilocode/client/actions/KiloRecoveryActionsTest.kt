package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

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

    fun `test restart action adds cli suffix in connection retry popup`() {
        val action = RestartKiloAction()
        val event = event(action, place = KiloActionPlaces.connectionRetryPopup())

        update(action, event)

        assertEquals("Restart CLI", event.presentation.text)
    }

    fun `test reinstall action adds cli suffix in connection retry popup`() {
        val action = ReinstallKiloAction()
        val event = event(action, place = KiloActionPlaces.connectionRetryPopup())

        update(action, event)

        assertEquals("Reinstall CLI", event.presentation.text)
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

    fun `test local config action refreshes missing target in background`() {
        rpc.localConfigPath = "/test/.kilo/kilo.jsonc"
        rpc.localConfigDisplayPath = "/test/.kilo/kilo.jsonc"
        rpc.localConfigExists = true
        val call = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeLocalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Open: local ...", event.presentation.text)
        await(call)
        assertEquals(1, rpc.localConfigPathCalls)

        gate.complete(Unit)
        service().localConfig["/test"] = ConfigTargetDto("/test/.kilo/kilo.jsonc", "/test/.kilo/kilo.jsonc", true)

        val next = event(action, workspace = workspace("/test"))
        update(action, next)

        assertEquals("Open: local /test/.kilo/kilo.jsonc", next.presentation.text)
    }

    fun `test local config action dedupes in flight refresh`() {
        val gate = CompletableDeferred<Unit>()
        val call = CompletableDeferred<Unit>()
        val action = OpenLocalConfigAction()
        rpc.beforeLocalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }

        update(action, event(action, workspace = workspace("/test")))
        await(call)
        update(action, event(action, workspace = workspace("/test")))

        assertEquals(1, rpc.localConfigPathCalls)

        gate.complete(Unit)
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

    fun `test global config action refreshes missing target in background`() {
        rpc.globalConfigPath = "/config/kilo.jsonc"
        rpc.globalConfigDisplayPath = "/config/kilo.jsonc"
        rpc.globalConfigExists = true
        val call = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGlobalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Open: global ...", event.presentation.text)
        await(call)
        assertEquals(1, rpc.globalConfigPathCalls)

        gate.complete(Unit)
        cacheGlobal(ConfigTargetDto("/config/kilo.jsonc", "/config/kilo.jsonc", true))

        val next = event(action)
        update(action, next)

        assertEquals("Open: global /config/kilo.jsonc", next.presentation.text)
    }

    fun `test global config action dedupes in flight refresh`() {
        val gate = CompletableDeferred<Unit>()
        val call = CompletableDeferred<Unit>()
        rpc.beforeGlobalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenGlobalConfigAction()

        update(action, event(action))
        await(call)
        update(action, event(action))

        assertEquals(1, rpc.globalConfigPathCalls)

        gate.complete(Unit)
    }

    fun `test local config action disables without directory`() {
        val action = OpenLocalConfigAction()
        val event = event(action)

        update(action, event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test settings popup group updates recursively in background`() {
        val group = DefaultActionGroup()
        val wrapped = KiloSettingsAction.popupGroup(group)

        assertEquals(ActionUpdateThread.BGT, wrapped.actionUpdateThread)
    }

    fun `test settings action prewarms config targets`() {
        val action = KiloSettingsAction()

        runBlocking {
            KiloSettingsAction.refreshConfigTargets(event(action, workspace = workspace("/test")), service()).forEach { it.join() }
        }

        assertEquals(1, rpc.localConfigPathCalls)
        assertEquals(1, rpc.globalConfigPathCalls)
    }

    fun `test workspace creation prewarms config targets`() {
        val local = CompletableDeferred<Unit>()
        val global = CompletableDeferred<Unit>()
        rpc.beforeLocalConfigTarget = { local.complete(Unit) }
        rpc.beforeGlobalConfigTarget = { global.complete(Unit) }

        service().workspace("/test")

        await(local)
        await(global)
        assertEquals(1, rpc.localConfigPathCalls)
        assertEquals(1, rpc.globalConfigPathCalls)
    }

    private fun event(action: AnAction, workspace: Workspace? = null, place: String = ""): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        presentation.isEnabled = false
        return AnActionEvent.createFromDataContext(place, presentation, context(workspace))
    }

    private fun update(action: AnAction, event: AnActionEvent) {
        ApplicationManager.getApplication().executeOnPooledThread {
            ActionUtil.updateAction(action, event)
        }.get()
    }

    private fun await(signal: CompletableDeferred<Unit>) = runBlocking {
        withTimeout(5_000) { signal.await() }
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
