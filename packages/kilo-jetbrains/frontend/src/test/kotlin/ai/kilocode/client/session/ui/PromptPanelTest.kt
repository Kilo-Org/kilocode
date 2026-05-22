package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.PromptPanel
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.EmptyIcon
import javax.swing.SwingUtilities

@Suppress("UnstableApiUsage")
class PromptPanelTest : BasePlatformTestCase() {

    fun `test prompt input uses editor font settings`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project, {}, {})
        val font = panel.inputFont()

        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
    }

    fun `test prompt input uses editor background`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project, {}, {})

        assertEquals(style.editorScheme.defaultBackground, panel.defaultFocusedComponent.background)
    }

    fun `test applyStyle updates prompt input and height`() {
        val panel = PromptPanel(project, {}, {})
        val style = SessionEditorStyle.create(family = "Courier New", size = 26)

        panel.applyStyle(style)

        assertEquals("Courier New", panel.inputFont().name)
        assertEquals(26, panel.inputFont().size)
        assertTrue(panel.preferredSize.height >= 26)
    }

    fun `test reasoning picker hides when variants are empty`() {
        val panel = PromptPanel(project, {}, {})

        panel.reasoning.setItems(emptyList())

        assertFalse(panel.reasoning.isVisible)
    }

    fun `test reasoning picker shows selected variant`() {
        val panel = PromptPanel(project, {}, {})

        panel.reasoning.setItems(listOf(ReasoningPicker.Item("low", "Low"), ReasoningPicker.Item("high", "High")), "high")

        assertTrue(panel.reasoning.isVisible)
        assertEquals("high", panel.reasoning.selectedForTest()?.id)
    }

    fun `test reasoning picker aligns unchecked rows`() {
        val picker = ReasoningPicker()
        val low = ReasoningPicker.Item("low", "Low")
        val high = ReasoningPicker.Item("high", "High")

        picker.setItems(listOf(low, high), "high")

        val icon = picker.iconForTest(low)
        assertTrue(icon is EmptyIcon)
        assertSame(AllIcons.Actions.Checked, picker.iconForTest(high))
        assertEquals(AllIcons.Actions.Checked.iconWidth, icon.iconWidth)
        assertEquals(AllIcons.Actions.Checked.iconHeight, icon.iconHeight)
    }

    fun `test reset visibility can be toggled`() {
        val panel = PromptPanel(project, {}, {})

        panel.setResetVisible(true)

        assertTrue(panel.resetVisibleForTest())
    }

    fun `test prompt editor exposes send context`() {
        val panel = PromptPanel(project, {}, {})
        val sink = TestSink()

        (panel.defaultFocusedComponent as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt button exposes send context`() {
        val panel = PromptPanel(project, {}, {})
        val sink = TestSink()

        (panel.buttonForTest() as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt button switches between send and stop state`() {
        val panel = PromptPanel(project, {}, {})

        assertEquals(KeymapUtil.createTooltipText("Send", "Kilo.SendPrompt"), panel.buttonForTest().toolTipText)
        assertFalse(panel.isStopEnabled)

        panel.setBusy(true)

        assertEquals("Stop", panel.buttonForTest().toolTipText)
        assertTrue(panel.isStopEnabled)
    }

    fun `test pickers belong to rounded shell`() {
        val panel = PromptPanel(project, {}, {})
        val shell = panel.shellForTest()

        assertTrue(SwingUtilities.isDescendingFrom(panel.mode, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.model, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.reasoning, shell))
        assertSame(shell, panel.mode.parent.parent)
    }

    private class TestSink : DataSink {
        var send: Any? = null

        override fun <T : Any> set(key: com.intellij.openapi.actionSystem.DataKey<T>, data: T?) {
            if (key == PromptDataKeys.SEND) send = data
        }

        override fun <T : Any> setNull(key: com.intellij.openapi.actionSystem.DataKey<T>) {
        }

        override fun <T : Any> lazyNull(key: com.intellij.openapi.actionSystem.DataKey<T>) {
        }

        override fun <T : Any> lazyValue(
            key: com.intellij.openapi.actionSystem.DataKey<T>,
            data: (com.intellij.openapi.actionSystem.DataMap) -> T?,
        ) {
        }

        override fun uiDataSnapshot(provider: com.intellij.openapi.actionSystem.UiDataProvider) {
            provider.uiDataSnapshot(this)
        }

        override fun dataSnapshot(provider: com.intellij.openapi.actionSystem.DataSnapshotProvider) {
            provider.dataSnapshot(this)
        }

        override fun uiDataSnapshot(provider: com.intellij.openapi.actionSystem.DataProvider) {
        }
    }

}
