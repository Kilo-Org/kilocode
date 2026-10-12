package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.ApprovalReasonVisibilityListener
import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.settings.TranscriptDisplay
import ai.kilocode.client.session.settings.TranscriptDisplayListener
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.OnOffButton
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.JComponent

@Suppress("UnstableApiUsage")
class TranscriptConfigurableTest : BasePlatformTestCase() {

    private lateinit var timers: TestUiTimers

    override fun setUp() {
        super.setUp()
        timers = TestUiTimers()
        // Start every test from the VS Code defaults so persisted state from other suites cannot leak
        // into the draft/saved comparisons.
        KiloPluginSettings.setTranscriptDisplay(DEFAULTS)
    }

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetShowApprovalReason()
            KiloPluginSettings.unsetReasoningDisplay()
            KiloPluginSettings.unsetTerminalCommandDisplay()
            KiloPluginSettings.unsetCodeEditDisplay()
            KiloPluginSettings.unsetMcpToolDisplay()
            KiloPluginSettings.unsetHoverPreview()
        } finally {
            super.tearDown()
        }
    }

    fun `test id matches xml registration`() {
        assertEquals("ai.kilocode.jetbrains.settings.transcript", TranscriptConfigurable().id)
    }

    fun `test page is searchable and opts out of platform margin and scrollpane`() {
        val cfg: Configurable = TranscriptConfigurable()
        assertTrue(cfg is SearchableConfigurable)
        assertTrue(cfg is Configurable.NoMargin)
        assertTrue(cfg is Configurable.NoScroll)
    }

    fun `test defaults match vs code`() {
        open { ui ->
            val toggles = toggles(ui.controlsForTest())
            assertEquals(ReasoningDisplay.EXPANDED, combos(ui.controlsForTest()).single().selectedItem)
            assertTrue("approval reason on by default", toggles[APPROVAL].isSelected)
            assertTrue("terminal expanded by default", toggles[TERMINAL].isSelected)
            assertFalse("code edit collapsed by default", toggles[CODE_EDIT].isSelected)
            assertFalse("mcp tool collapsed by default", toggles[MCP_TOOL].isSelected)
            assertTrue("hover preview on by default", toggles[HOVER].isSelected)
        }
    }

    // Expanded-vs-collapsed is a binary, so those rows are switches, not two-item dropdowns.
    fun `test block rows are toggles that map on to expanded`() {
        open { ui ->
            assertEquals("only reasoning needs a dropdown", 1, combos(ui.controlsForTest()).size)
            val toggles = toggles(ui.controlsForTest())

            toggles[CODE_EDIT].doClick()
            toggles[TERMINAL].doClick()
            ui.applyDraft()

            assertEquals(BlockDisplay.EXPANDED, KiloPluginSettings.getCodeEditDisplay())
            assertEquals(BlockDisplay.COLLAPSED, KiloPluginSettings.getTerminalCommandDisplay())
        }
    }

    fun `test block toggles update the unsaved preview immediately`() {
        open { ui ->
            ui.setSize(1000, 1000)
            layoutTree(ui)
            val toggles = toggles(ui.controlsForTest())
            val preview = ui.previewForTest()
            assertTrue(preview.shellCard().isExpanded())
            assertFalse(preview.editCard().isExpanded())
            assertFalse(preview.mcpCard().isExpanded())
            val shell = preview.shellCard().height
            val edit = preview.editCard().height
            val mcp = preview.mcpCard().height

            toggles[TERMINAL].doClick()
            toggles[CODE_EDIT].doClick()
            toggles[MCP_TOOL].doClick()
            revealAll()
            UIUtil.dispatchAllInvocationEvents()
            layoutTree(ui)

            assertFalse("terminal switch closes the sample", preview.shellCard().isExpanded())
            assertTrue("code edit switch opens the sample", preview.editCard().isExpanded())
            assertTrue("MCP switch opens the sample", preview.mcpCard().isExpanded())
            assertTrue("closed terminal must shrink visibly", preview.shellCard().height < shell)
            assertTrue("open code edit must grow visibly", preview.editCard().height > edit)
            assertTrue("open MCP tool must grow visibly", preview.mcpCard().height > mcp)
            assertEquals("draft still is not persisted", DEFAULTS, KiloPluginSettings.getTranscriptDisplay())
        }
    }

    fun `test changing a control does not write or publish until apply`() {
        val displayEvents = mutableListOf<TranscriptDisplay>()
        val reasonEvents = mutableListOf<Boolean>()
        val bus = ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
        bus.subscribe(TranscriptDisplayListener.TOPIC, TranscriptDisplayListener { displayEvents += it })
        bus.subscribe(ApprovalReasonVisibilityListener.TOPIC, ApprovalReasonVisibilityListener { reasonEvents += it })
        open { ui ->
            combos(ui.controlsForTest())[0].selectedItem = ReasoningDisplay.HEADLINE
            toggles(ui.controlsForTest()).first().doClick()
            assertTrue(ui.modified())
            assertEquals("no persisted write", ReasoningDisplay.EXPANDED, KiloPluginSettings.getReasoningDisplay())
            assertTrue("no persisted approval write", KiloPluginSettings.getShowApprovalReason())
            assertTrue(displayEvents.isEmpty())
            assertTrue(reasonEvents.isEmpty())

            ui.applyDraft()

            assertEquals(ReasoningDisplay.HEADLINE, KiloPluginSettings.getReasoningDisplay())
            assertFalse(KiloPluginSettings.getShowApprovalReason())
            assertEquals(1, displayEvents.size)
            assertEquals(1, reasonEvents.size)
        }
    }

    fun `test apply publishes nothing when only hover changes`() {
        var displayEvents = 0
        var reasonEvents = 0
        val bus = ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
        bus.subscribe(TranscriptDisplayListener.TOPIC, TranscriptDisplayListener { displayEvents++ })
        bus.subscribe(ApprovalReasonVisibilityListener.TOPIC, ApprovalReasonVisibilityListener { reasonEvents++ })
        open { ui ->
            toggles(ui.controlsForTest()).last().doClick()
            ui.applyDraft()
            assertFalse(KiloPluginSettings.getHoverPreview())
            assertEquals("hover needs no appearance broadcast", 0, displayEvents)
            assertEquals(0, reasonEvents)
        }
    }

    fun `test reset reverts the draft without touching persisted state`() {
        open { ui ->
            combos(ui.controlsForTest())[0].selectedItem = ReasoningDisplay.HEADLINE
            toggles(ui.controlsForTest()).first().doClick()
            assertTrue(ui.modified())

            ui.resetDraft()

            assertFalse(ui.modified())
            assertEquals(ReasoningDisplay.EXPANDED, combos(ui.controlsForTest())[0].selectedItem)
            assertTrue(toggles(ui.controlsForTest()).first().isSelected)
            assertEquals(ReasoningDisplay.EXPANDED, KiloPluginSettings.getReasoningDisplay())
        }
    }

    fun `test configurable reports modified and applies through the platform`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            assertFalse(cfg.isModified)
            val ui = uiOf(panel)
            combos(ui.controlsForTest())[0].selectedItem = ReasoningDisplay.HEADLINE
            assertTrue(cfg.isModified)
            cfg.apply()
            assertFalse(cfg.isModified)
            assertEquals(ReasoningDisplay.HEADLINE, KiloPluginSettings.getReasoningDisplay())
            cfg.disposeUIResources()
        }
    }

    fun `test page splits controls above a preview that tracks its half`() {
        open { ui ->
            ui.setSize(800, 600)
            layoutTree(ui)
            val preview = ui.previewForTest()
            val short = preview.height
            assertTrue("controls must keep their own half", ui.controlsForTest().height > 0)
            assertTrue("preview must be laid out", short > 0)
            val spot = javax.swing.SwingUtilities.convertPoint(preview, 0, 0, ui)
            assertTrue("preview sits below the controls", spot.y > 0)

            ui.setSize(800, 1200)
            layoutTree(ui)

            // A preview sized to its own preferred height (e.g. nested in a Stack) ignores the space the
            // splitter gives it, so it never grows with the dialog.
            assertTrue(
                "preview must grow with its splitter half, got $short then ${preview.height}",
                preview.height > short,
            )
        }
    }

    // -- helpers --

    private fun <T> open(block: (TranscriptSettingsUi) -> T): T = edt {
        val ui = TranscriptSettingsUi(timers)
        try {
            revealAll()
            block(ui)
        } finally {
            ui.dispose()
        }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun layoutTree(component: java.awt.Component) {
        component.doLayout()
        if (component is Container) component.components.forEach { layoutTree(it) }
    }

    private fun revealAll() {
        repeat(3) { timers.advanceBy(PREVIEW_STEP_MS.toLong()) }
    }

    private fun uiOf(root: JComponent): TranscriptSettingsUi {
        fun visit(component: java.awt.Component): TranscriptSettingsUi? {
            if (component is TranscriptSettingsUi) return component
            if (component is Container) {
                for (child in component.components) visit(child)?.let { return it }
            }
            return null
        }
        return visit(root) ?: error("TranscriptSettingsUi not found")
    }

    private fun toggles(root: Container): List<OnOffButton> = buildList {
        for (comp in root.components) {
            if (comp is OnOffButton) add(comp)
            if (comp is Container) addAll(toggles(comp))
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun combos(root: Container): List<ComboBox<Any>> = buildList {
        for (comp in root.components) {
            if (comp is ComboBox<*>) add(comp as ComboBox<Any>)
            if (comp is Container) addAll(combos(comp))
        }
    }

    companion object {
        private val DEFAULTS = TranscriptDisplay(reasoning = ReasoningDisplay.EXPANDED)

        // Toggle order follows the rendered rows: approval reason, terminal, code edit, MCP, hover.
        private const val APPROVAL = 0
        private const val TERMINAL = 1
        private const val CODE_EDIT = 2
        private const val MCP_TOOL = 3
        private const val HOVER = 4
    }
}
