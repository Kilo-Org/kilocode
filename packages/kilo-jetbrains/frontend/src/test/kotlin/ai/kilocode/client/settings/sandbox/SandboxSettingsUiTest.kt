package ai.kilocode.client.settings.sandbox

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SandboxNetworkDto
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class SandboxSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appScope: CoroutineScope
    private lateinit var uiScope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var ui: SandboxSettingsUi? = null

    override fun setUp() {
        super.setUp()
        appScope = CoroutineScope(SupervisorJob())
        uiScope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(appScope, rpc)
        workspaces = KiloWorkspaceService(appScope, FakeWorkspaceRpcApi())
        val state = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        rpc.state.value = state
        app._state.value = state
        edt { ui = SandboxSettingsUi(uiScope, app, workspaces) }
        flushUntil { lists(requireUi()).size == 2 }
    }

    override fun tearDown() {
        try {
            ui?.let { panel -> edt { panel.dispose() } }
            ui = null
            uiScope.cancel()
            appScope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test missing enabled value renders as exposed without marking modified`() {
        val panel = requireUi()

        edt {
            assertTrue(toggle(panel).isSelected)
            assertEquals(SandboxNetworkDto.DENY, combo(panel).selectedItem)
            assertFalse(panel.modified())
        }
    }

    fun `test edits send one global sandbox patch body`() {
        val panel = requireUi()

        edt {
            val lists = lists(panel)
            lists[0].input = { "api.github.com" }
            click(button(lists[0], 0))
            lists[1].input = { "~/shared-output" }
            click(button(lists[1], 0))
            combo(panel).selectedItem = SandboxNetworkDto.ALLOW
            toggle(panel).doClick()
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        val sandbox = rpc.configPatches.single().sandbox
        assertEquals(false, sandbox?.enabled)
        assertEquals(SandboxNetworkDto.ALLOW, sandbox?.network)
        assertEquals(listOf("api.github.com:443"), sandbox?.allowedHosts)
        assertEquals(listOf("~/shared-output"), sandbox?.writablePaths)
        assertTrue(rpc.configPatches.single().values.isEmpty())
        flushUntil { !edt { panel.modified() } }
    }

    fun `test invalid network destinations do not enter the draft`() {
        val panel = requireUi()

        edt {
            val hosts = lists(panel)[0]
            hosts.input = { "*.github.com" }
            click(button(hosts, 0))
            assertFalse(panel.modified())
        }

        assertTrue(rpc.configPatches.isEmpty())
    }

    fun `test explicit false is rendered off and reset restores it`() {
        val panel = requireUi()
        val state = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(sandbox = ai.kilocode.rpc.dto.SandboxConfigDto(enabled = false)),
        )
        rpc.state.value = state
        app._state.value = state
        flushUntil { !edt { toggle(panel).isSelected } }

        edt {
            toggle(panel).doClick()
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(toggle(panel).isSelected)
            assertFalse(panel.modified())
        }
    }

    private fun requireUi() = requireNotNull(ui)

    private fun toggle(panel: SandboxSettingsUi): SettingsToggle = components(panel).filterIsInstance<SettingsToggle>().single()

    private fun combo(panel: SandboxSettingsUi): ComboBox<*> = components(panel).filterIsInstance<ComboBox<*>>().single()

    private fun lists(panel: SandboxSettingsUi): List<SandboxValueList> = components(panel).filterIsInstance<SandboxValueList>()

    private fun button(list: SandboxValueList, index: Int): JComponent = components(list)
        .filterIsInstance<JComponent>()
        .filter { it.javaClass.name.endsWith("ActionButton") }
        .let { it[index] }

    private fun click(target: JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        val press = MouseEvent(target, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), InputEvent.BUTTON1_DOWN_MASK, point.x, point.y, 1, false, MouseEvent.BUTTON1)
        val release = MouseEvent(target, MouseEvent.MOUSE_RELEASED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1)
        val clicked = MouseEvent(target, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1)
        target.dispatchEvent(press)
        target.dispatchEvent(release)
        target.dispatchEvent(clicked)
        UIUtil.dispatchAllInvocationEvents()
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

    private fun components(root: Container): List<java.awt.Component> = buildList {
        fun visit(comp: java.awt.Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }
}
