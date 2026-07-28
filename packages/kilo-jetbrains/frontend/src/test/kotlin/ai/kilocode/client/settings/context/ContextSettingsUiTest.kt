package ai.kilocode.client.settings.context

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.CompactionConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.WatcherConfigDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Container
import java.awt.event.MouseEvent
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.ListSelectionModel
import javax.swing.JTextField
import javax.swing.text.AbstractDocument
import javax.swing.text.JTextComponent

class ContextSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appScope: CoroutineScope
    private lateinit var uiScope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var ui: ContextSettingsUi? = null

    override fun setUp() {
        super.setUp()
        appScope = CoroutineScope(SupervisorJob())
        uiScope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        workspaceRpc = FakeWorkspaceRpcApi()
        app = KiloAppService(appScope, rpc)
        workspaces = KiloWorkspaceService(appScope, workspaceRpc)
        val state = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                watcher = WatcherConfigDto(ignore = listOf("tmp/**")),
                compaction = CompactionConfigDto(auto = true, threshold_percent = 75.0, prune = true),
            ),
        )
        rpc.state.value = state
        app._state.value = state
        edt { ui = ContextSettingsUi(uiScope, app, workspaces) }
        flushUntil { text(requireUi()).contains("Auto Compaction") }
    }

    override fun tearDown() {
        try {
            val panel = ui
            if (panel != null) edt { panel.dispose() }
            ui = null
            uiScope.cancel()
            appScope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test toggling compaction sends boolean false values`() {
        val panel = requireUi()

        edt {
            val toggles = components(panel).filterIsInstance<SettingsToggle>()
            toggles[0].doClick()
            toggles[1].doClick()
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        val patch = rpc.configPatches.single()
        assertEquals(false, patch.compaction?.auto)
        assertEquals(false, patch.compaction?.prune)
    }

    fun `test editing threshold sends number`() {
        val panel = requireUi()

        edt {
            threshold(panel).text = "80"
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(80.0, rpc.configPatches.single().compaction?.threshold_percent)
    }

    fun `test threshold row shows percent label and rejects out of range values`() {
        val panel = requireUi()

        edt {
            val field = threshold(panel)
            assertTrue(text(panel).contains("%"))
            assertTrue(text(panel).contains("Auto Compaction Limit"))
            assertTrue(text(panel).contains("Prune Old Outputs"))
            assertEquals("Default", field.emptyText.text)
            field.text = ""
            field.text = "101"
            assertEquals("", field.text)
            field.text = "100"
            assertEquals("100", field.text)
            (field.document as AbstractDocument).replace(0, field.document.length, "-1", null)
            assertEquals("100", field.text)
        }
    }

    fun `test clearing threshold sends clear patch`() {
        val panel = requireUi()

        edt {
            threshold(panel).text = ""
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(listOf("threshold_percent"), rpc.configPatches.single().compaction?.clear)
    }

    fun `test adding watcher pattern sends full list`() {
        val panel = requireUi()

        edt {
            val patterns = components(panel).filterIsInstance<PatternList>().single()
            patterns.input = { "**/dist/**" }
            icon(panel, "Add pattern").doClick()
            assertEquals(listOf("**/dist/**"), patternList(panel).selectedValuesList)
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(listOf("tmp/**", "**/dist/**"), rpc.configPatches.single().watcher?.ignore)
    }

    fun `test stale config update result keeps watcher pattern visible`() {
        val panel = requireUi()
        rpc.configUpdateReturnStale = true

        edt {
            val patterns = components(panel).filterIsInstance<PatternList>().single()
            patterns.input = { "**/dist/**" }
            icon(panel, "Add pattern").doClick()
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() && !edt { panel.modified() } }
        edt {
            val list = patternList(panel)
            assertEquals(listOf("**/dist/**"), list.selectedValuesList)
            assertEquals(listOf("tmp/**", "**/dist/**"), (0 until list.model.size).map { list.model.getElementAt(it) })
        }
    }

    fun `test removing selected watcher patterns supports multi selection`() {
        val panel = requireUi()

        edt {
            val patterns = components(panel).filterIsInstance<PatternList>().single()
            val inputs = ArrayDeque(listOf("**/dist/**", "**/build/**"))
            patterns.input = { inputs.removeFirst() }
            icon(panel, "Add pattern").doClick()
            icon(panel, "Add pattern").doClick()
            val list = patternList(panel)
            assertEquals(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION, list.selectionMode)
            list.setSelectionInterval(0, 1)
            icon(panel, "Remove selected patterns").doClick()
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(listOf("**/build/**"), rpc.configPatches.single().watcher?.ignore)
    }

    fun `test double clicking watcher pattern edits it`() {
        val panel = requireUi()

        edt {
            val patterns = components(panel).filterIsInstance<PatternList>().single()
            patterns.editor = { "**/edited/**" }
            val list = patternList(panel)
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            val event = MouseEvent(
                list,
                MouseEvent.MOUSE_CLICKED,
                System.currentTimeMillis(),
                0,
                bounds.x + 1,
                bounds.y + 1,
                2,
                false,
                MouseEvent.BUTTON1,
            )
            list.mouseListeners.forEach { it.mouseClicked(event) }
            assertEquals(listOf("**/edited/**"), list.selectedValuesList)
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(listOf("**/edited/**"), rpc.configPatches.single().watcher?.ignore)
    }

    fun `test watcher pattern renderer has left inset`() {
        val panel = requireUi()

        edt {
            val list = patternList(panel)
            val comp = list.cellRenderer.getListCellRendererComponent(list, "tmp/**", 0, false, false) as JComponent
            assertTrue(comp.insets.left > 0)
        }
    }

    fun `test watcher section does not repeat ignored patterns row title`() {
        val panel = requireUi()

        edt {
            assertFalse(text(panel).contains("Ignored patterns"))
            assertTrue(text(panel).contains("File Watcher Ignore Patterns"))
            assertEquals(1, components(panel).filterIsInstance<JTextField>().size)
        }
    }

    fun `test failed apply stays visible while panel open`() {
        val panel = requireUi()
        rpc.configUpdateError = RuntimeException("save failed")

        edt {
            threshold(panel).text = "80"
            panel.applyDraft()
        }

        flushUntil { text(panel).contains("Failed to save context settings") }
        edt {
            assertTrue(text(panel.progress).contains("Failed to save context settings"))
            assertTrue(panel.modified())
        }
    }

    fun `test controls are disabled during pending save`() {
        val panel = requireUi()
        rpc.configUpdateGate = CompletableDeferred()

        edt {
            threshold(panel).text = "80"
            panel.applyDraft()
            assertTrue(components(panel).filterIsInstance<SettingsToggle>().all { !it.isEnabled })
            assertFalse(threshold(panel).isEnabled)
        }

        rpc.configUpdateGate?.complete(Unit)
        flushUntil { rpc.configPatches.isNotEmpty() }
    }

    private fun requireUi(): ContextSettingsUi = requireNotNull(ui)

    private fun threshold(panel: ContextSettingsUi): JBTextField = components(panel)
        .filterIsInstance<JBTextField>()
        .single { it.columns == 8 }

    private fun patternList(panel: ContextSettingsUi): JBList<String> {
        val list = components(panel).filterIsInstance<JBList<*>>().single()
        @Suppress("UNCHECKED_CAST")
        return list as JBList<String>
    }

    private fun icon(panel: ContextSettingsUi, tip: String): HoverIcon = components(panel)
        .filterIsInstance<HoverIcon>()
        .single { it.toolTipText == tip }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
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
}
