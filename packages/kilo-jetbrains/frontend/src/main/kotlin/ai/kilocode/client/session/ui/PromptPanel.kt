package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.EditorTextField
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/**
 * Prompt input panel with an IntelliJ editor text field and a bottom
 * bar containing mode/model pickers and a send/stop button, all on
 * the same row stretched to the same height.
 *
 * Layout:
 * ```
 * ┌──────────────────────────────────┐
 * │  EditorTextField (3 lines)       │
 * ├──────────────────────────────────┤
 * │ [Default ▾] [sonnet ▾]     [▶]  │
 * └──────────────────────────────────┘
 * ```
 */
class PromptPanel(
    private val project: Project,
    private val onSend: (String) -> Unit,
    private val onAbort: () -> Unit,
) : JPanel(BorderLayout()) {

    companion object {
        private val LOG = KiloLog.create(PromptPanel::class.java)
        private val SEND_ICON: Icon = IconLoader.getIcon("/icons/send.svg", PromptPanel::class.java)
        private val STOP_ICON: Icon = IconLoader.getIcon("/icons/stop.svg", PromptPanel::class.java)
        private const val EDITOR_LINES = 3
    }

    val mode = LabelPicker()
    val model = LabelPicker()

    private val editor = EditorTextField(project, PlainTextFileType.INSTANCE).apply {
        setPlaceholder(KiloBundle.message("prompt.placeholder"))
        setShowPlaceholderWhenFocused(true)
        setOneLineMode(false)
        addSettingsProvider { ed ->
            ed.settings.isUseSoftWraps = true
            ed.settings.isAdditionalPageAtBottom = false
            ed.scrollPane.horizontalScrollBarPolicy =
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            ed.contentComponent.addKeyListener(object : KeyAdapter() {
                 override fun keyPressed(e: KeyEvent) {
                     if (e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown) {
                         e.consume()
                         submit("enter")
                     }
                 }
             })
        }
    }

    private val button = JButton(SEND_ICON).apply {
        isBorderPainted = false
        isContentAreaFilled = false
        isFocusPainted = false
        toolTipText = KiloBundle.message("prompt.button.send")
        isEnabled = false
        maximumSize = Dimension(JBUI.scale(28), Short.MAX_VALUE.toInt())
        preferredSize = Dimension(JBUI.scale(28), JBUI.scale(24))
        addActionListener {
            if (busy) onAbort()
            else submit("button")
        }
    }

    @Volatile
    private var busy = false

    init {
        border = JBUI.Borders.empty(4, 8, 4, 8)

        // Editor in center — constrain height to ~3 lines
        val height = editor.font.size * EDITOR_LINES + JBUI.scale(16)
        editor.preferredSize = Dimension(0, height)
        editor.minimumSize = Dimension(0, height)
        add(editor, BorderLayout.CENTER)

        // Bottom bar: pickers + glue + send button, all same row & height
        val bar = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            isOpaque = false
            border = JBUI.Borders.emptyTop(4)
        }
        bar.add(mode)
        bar.add(model)
        bar.add(Box.createHorizontalGlue())
        bar.add(button)
        add(bar, BorderLayout.SOUTH)
    }

    fun setReady(value: Boolean) {
        button.isEnabled = value
    }

    fun setBusy(value: Boolean) {
        busy = value
        button.icon = if (value) STOP_ICON else SEND_ICON
        button.toolTipText = if (value) KiloBundle.message("prompt.button.stop") else KiloBundle.message("prompt.button.send")
    }

    fun text(): String = editor.text.trim()

    fun clear() {
        editor.text = ""
    }

    fun focus() {
        editor.requestFocusInWindow()
    }

    private fun submit(src: String) {
        if (busy) return
        val txt = text()
        LOG.debug { "${ChatLogSummary.prompt(txt)} src=$src busy=$busy" }
        if (txt.isNotEmpty()) {
            onSend(txt)
        }
    }
}
