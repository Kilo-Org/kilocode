package ai.kilocode.client.settings.base

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.BorderLayout
import java.awt.Container
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.text.JTextComponent

class KiloReadyConfigurableTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService
    private var cfg: FakeConfigurable? = null

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(scope, rpc)
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
    }

    override fun tearDown() {
        try {
            cfg?.disposeUIResources()
            cfg = null
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test disconnected shows unavailable and does not create ready component`() {
        val root = edt { create().createComponent() }
        flushUntil { rpc.connected }

        edt {
            val text = text(root)
            assertTrue(text, text.contains(KiloBundle.message("settings.cli.unavailable.title")))
            assertTrue(text, text.contains(KiloBundle.message("settings.cli.unavailable.message")))
            assertEquals(0, cfg?.created)
        }
    }

    fun `test ready transition creates ready component once`() {
        val root = edt { create().createComponent() }
        flushUntil { rpc.connected }

        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { cfg?.created == 1 } }
        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
        flush()

        edt {
            assertEquals(1, cfg?.created)
            assertTrue(text(root).contains("Ready content"))
            assertFalse(text(root).contains(KiloBundle.message("settings.cli.unavailable.title")))
        }
    }

    fun `test actions are safe before ready and delegate after ready`() {
        val view = create()
        edt { view.createComponent() }

        edt {
            assertFalse(view.isModified)
            view.apply()
            view.reset()
            assertEquals(0, view.applied)
            assertEquals(0, view.reset)
        }

        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { view.created == 1 } }

        edt {
            view.modified = true
            assertTrue(view.isModified)
            view.apply()
            view.reset()
            assertEquals(1, view.applied)
            assertEquals(1, view.reset)
        }
    }

    fun `test focus request is delegated after ready`() {
        val view = create()
        edt {
            view.createComponent()
            view.focusOn("account")
            assertEquals(listOf("account"), view.focuses)
            assertNull(view.preferredFocusedComponent)
        }

        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { view.created == 1 } }

        edt { assertSame(view.field, view.preferredFocusedComponent) }
    }

    fun `test dispose cancels scope and disposes ready UI on edt`() {
        val view = create()
        edt { view.createComponent() }
        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { view.created == 1 } }

        edt { view.disposeUIResources() }
        cfg = null

        assertEquals(1, view.disposed)
        assertTrue(view.disposedOnEdt)
    }

    fun `test ready settings overlay is hosted by outer shell`() {
        val view = create(overlay = true)
        val root = edt { view.createComponent() as SettingsPanel }
        flushUntil { rpc.connected }

        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { view.readyPanel != null } }

        edt {
            val ready = requireNotNull(view.readyPanel)
            ready.showProgress("Authorizing provider")

            assertTrue(text(root).contains("Authorizing provider"))
            assertTrue(root.progress.isVisible)
            assertFalse(ready.progress.isVisible)
            assertTrue(root.overlay.components.any { it === root.progress })
            assertFalse(ready.overlay.components.any { it === root.progress })
        }

        edt { view.disposeUIResources() }
        cfg = null

        edt { assertFalse(root.progress.isVisible) }
    }

    fun `test no scroll shell hosts ready component directly`() {
        val view = create(scroll = false)
        val root = edt { view.createComponent() as SettingsOverlayPanel }
        flushUntil { rpc.connected }

        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flushUntil { edt { view.created == 1 } }

        edt {
            assertFalse(root is SettingsPanel)
            assertTrue(components(root).filterIsInstance<JScrollPane>().isEmpty())
            assertSame(view.ready, (root.content.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER))
            assertTrue(text(root).contains("Ready content"))
        }
    }

    private fun create(overlay: Boolean = false, scroll: Boolean = true): FakeConfigurable {
        val view = FakeConfigurable(overlay, scroll)
        cfg = view
        return view
    }

    private fun flush() = runBlocking {
        delay(100)
        edt { UIUtil.dispatchAllInvocationEvents() }
    }

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(20) {
            delay(100)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue(done())
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
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

    private fun components(root: Container): List<java.awt.Component> = buildList {
        fun visit(comp: java.awt.Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }

    private class FakeConfigurable(
        private val overlay: Boolean = false,
        private val scroll: Boolean = true,
    ) : KiloReadyConfigurable() {
        val field = JPanel()
        val focuses = mutableListOf<String>()
        var ready: JComponent? = null
            private set
        var readyPanel: SettingsPanel? = null
            private set
        var created = 0
            private set
        var disposed = 0
            private set
        var disposedOnEdt = false
            private set
        var modified = false
        var applied = 0
            private set
        var reset = 0
            private set

        override fun getId(): String = "test.ready"

        override fun getDisplayName(): String = "Ready"

        override fun createReadyComponent(cs: CoroutineScope): JComponent {
            created++
            if (overlay) {
                val panel = SettingsPanel()
                panel.setContent(JPanel().apply { add(JLabel("Ready content")) })
                readyPanel = panel
                ready = panel
                return panel
            }
            val panel = JPanel().apply { add(JLabel("Ready content")) }
            ready = panel
            return panel
        }

        override fun scrollReadyShell(): Boolean = scroll

        override fun isModifiedReady(): Boolean = modified

        override fun applyReady() {
            applied++
        }

        override fun resetReady() {
            reset++
        }

        override fun preferredReady(): JComponent? = if (created > 0) field else null

        override fun focusReady(label: String) {
            focuses += label
        }

        override fun disposeReadyComponent(component: JComponent) {
            disposed++
            disposedOnEdt = ApplicationManager.getApplication().isDispatchThread
        }
    }
}
