package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.PromptPanel
import com.intellij.icons.AllIcons
import com.intellij.notification.Notification
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.EditorTextField
import com.intellij.util.ui.EmptyIcon
import kotlinx.coroutines.CancellationException
import java.awt.Container
import javax.swing.JButton
import javax.swing.SwingUtilities

@Suppress("UnstableApiUsage")
class PromptPanelTest : BasePlatformTestCase() {

    fun `test prompt input uses editor font settings`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val font = panel.inputFont()

        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
    }

    fun `test prompt input uses editor background`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project, {}, {}, { _, _ -> })

        assertEquals(style.editorScheme.defaultBackground, panel.defaultFocusedComponent.background)
    }

    fun `test applyStyle updates prompt input and height`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val style = SessionEditorStyle.create(family = "Courier New", size = 26)

        panel.applyStyle(style)

        assertEquals("Courier New", panel.inputFont().name)
        assertEquals(26, panel.inputFont().size)
        assertTrue(panel.preferredSize.height >= 26)
    }

    fun `test prompt editor grows when lines are added`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height

        editor.text = "one\ntwo\nthree\nfour\nfive"

        assertTrue(editor.preferredSize.height > min)
    }

    fun `test prompt editor shrinks when lines are removed`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height

        editor.text = "one\ntwo\nthree\nfour\nfive"
        assertTrue(editor.preferredSize.height > min)

        editor.text = "one"

        assertEquals(min, editor.preferredSize.height)
    }

    fun `test prompt editor shrinks after clear`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height

        editor.text = "one\ntwo\nthree\nfour\nfive"
        assertTrue(editor.preferredSize.height > min)

        panel.clear()

        assertEquals(min, editor.preferredSize.height)
    }

    fun `test reasoning picker hides when variants are empty`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })

        panel.reasoning.setItems(emptyList())

        assertFalse(panel.reasoning.isVisible)
    }

    fun `test reasoning picker shows selected variant`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })

        panel.reasoning.setItems(listOf(ReasoningPicker.Item("low", "Low"), ReasoningPicker.Item("high", "High")), "high")

        assertTrue(panel.reasoning.isVisible)
        assertEquals("high", panel.reasoning.selectedForTest()?.id)
        assertEquals("High ▾", panel.reasoning.text)
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
        val panel = PromptPanel(project, {}, {}, { _, _ -> })

        panel.setResetVisible(true)

        assertTrue(panel.resetVisibleForTest())
    }

    fun `test prompt editor exposes send context`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val sink = TestSink()

        (panel.defaultFocusedComponent as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt button exposes send context`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val sink = TestSink()

        (panel.buttonForTest() as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt button switches between send and stop state`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })

        assertEquals(KeymapUtil.createTooltipText("Send", "Kilo.SendPrompt"), panel.buttonForTest().toolTipText)
        assertFalse(panel.isStopEnabled)

        panel.setBusy(true)

        assertEquals("Stop", panel.buttonForTest().toolTipText)
        assertTrue(panel.isStopEnabled)
    }

    fun `test auto approve button toggles and updates tooltip`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val button = autoApproveButton(panel)
        var seen: Boolean? = null
        panel.onAutoApproveToggle = { seen = it }

        assertFalse(button.isSelected)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.enable"), button.accessibleContext.accessibleName)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.disabled.tooltip"), button.toolTipText)
        val icon = button.icon

        button.doClick()

        assertEquals(true, seen)

        panel.setAutoApprove(true)

        assertTrue(button.isSelected)
        assertNotSame(icon, button.icon)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.disable"), button.accessibleContext.accessibleName)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.enabled.tooltip"), button.toolTipText)

        button.doClick()

        assertEquals(false, seen)

        panel.setAutoApprove(false)

        assertSame(icon, button.icon)
    }

    fun `test auto approve and enhance buttons sit next to send button`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val auto = autoApproveButton(panel)
        val enhance = enhanceButton(panel)
        val send = panel.buttonForTest()
        val items = auto.parent.components.toList()

        assertTrue(SwingUtilities.isDescendingFrom(auto, panel.shellForTest()))
        assertSame(auto.parent, enhance.parent)
        assertSame(auto.parent, send.parent)
        assertEquals(2, items.indexOf(enhance) - items.indexOf(auto))
        assertEquals(2, items.indexOf(send) - items.indexOf(enhance))
    }

    fun `test enhance button follows connection and busy state`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val enhance = enhanceButton(panel)

        assertFalse(enhance.isEnabled)

        panel.setReady(true)
        assertTrue(enhance.isEnabled)

        panel.setBusy(true)
        assertFalse(enhance.isEnabled)

        panel.setBusy(false)
        assertTrue(enhance.isEnabled)
    }

    fun `test enhance button rewrites active draft`() {
        var seen: String? = null
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project, {}, {}, { text, done ->
            seen = text
            complete = done
        })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "  make a plan  "

        enhance.doClick()

        assertEquals("make a plan", seen)
        assertFalse(enhance.isEnabled)
        assertTrue(enhance.icon is AnimatedIcon)
        val icon = enhance.icon

        panel.setReady(true)

        assertSame(icon, enhance.icon)

        complete!!(Result.success("Use a focused implementation plan"))

        assertEquals("Use a focused implementation plan", editor.text)
        assertTrue(enhance.isEnabled)
        assertFalse(enhance.icon is AnimatedIcon)
    }

    fun `test edit while enhancing ignores stale completion`() {
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project, {}, {}, { _, done -> complete = done })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "first draft"

        enhance.doClick()
        editor.text = "edited draft"
        complete!!(Result.success("stale result"))

        assertEquals("edited draft", editor.text)
        assertTrue(enhance.isEnabled)
    }

    fun `test cancelled enhancement restores button without notification`() {
        val notes = mutableListOf<Notification>()
        val listener = object : Notifications {
            override fun notify(notification: Notification) {
                notes.add(notification)
            }
        }
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable).subscribe(Notifications.TOPIC, listener)
        project.messageBus.connect(testRootDisposable).subscribe(Notifications.TOPIC, listener)
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project, {}, {}, { _, done -> complete = done })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "keep this draft"

        enhance.doClick()
        complete!!(Result.failure(CancellationException("disposed")))

        assertEquals("keep this draft", editor.text)
        assertTrue(enhance.isEnabled)
        assertFalse(enhance.icon is AnimatedIcon)
        assertTrue(notes.isEmpty())
    }

    fun `test empty enhancement inserts explanation without request`() {
        var requests = 0
        val panel = PromptPanel(project, {}, {}, { _, _ -> requests++ })
        val editor = panel.defaultFocusedComponent as EditorTextField
        panel.setReady(true)

        enhanceButton(panel).doClick()

        assertEquals(0, requests)
        assertEquals(KiloBundle.message("prompt.action.enhance.description"), editor.text)
    }

    fun `test pickers belong to rounded shell`() {
        val panel = PromptPanel(project, {}, {}, { _, _ -> })
        val shell = panel.shellForTest()

        assertTrue(SwingUtilities.isDescendingFrom(panel.mode, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.model, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.reasoning, shell))
        assertSame(shell, panel.mode.parent.parent)
    }

    private fun autoApproveButton(panel: PromptPanel): JButton {
        val enable = KiloBundle.message("prompt.action.autoApprove.enable")
        val disable = KiloBundle.message("prompt.action.autoApprove.disable")
        return buttons(panel).first {
            val name = it.accessibleContext.accessibleName
            name == enable || name == disable
        }
    }

    private fun enhanceButton(panel: PromptPanel): JButton {
        val name = KiloBundle.message("prompt.action.enhance")
        return buttons(panel).first { it.accessibleContext.accessibleName == name }
    }

    private fun buttons(root: java.awt.Component): List<JButton> {
        val out = mutableListOf<JButton>()
        fun visit(node: java.awt.Component) {
            if (node is JButton) out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
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
