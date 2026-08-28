package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Out
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

@RequiresEdt
internal fun diagramContent(source: String, parent: Disposable): JComponent {
    val root = JPanel(BorderLayout())
    val label = JBLabel().apply {
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.pad())
        isVisible = false
    }
    val viewer = DiagramViewer(diagramPalette(SessionEditorStyle.current()))
    root.add(viewer, BorderLayout.CENTER)
    root.add(label, BorderLayout.SOUTH)

    fun render() {
        val style = SessionEditorStyle.current()
        viewer.surface(SessionUiStyle.Colors.codeBlockBackground())
        viewer.palette(diagramPalette(style))
        label.text = KiloBundle.message("diagram.rendering")
        label.foreground = SessionUiStyle.Text.Secondary.foreground()
        label.isVisible = true
        service<Diagrams>().render(source, diagramSpec(style), parent) { out ->
            when (out) {
                is Out.Ok -> {
                    viewer.art(out.art)
                    label.isVisible = false
                }

                // An unsupported diagram type is a note, not a failure; the source tab still has the text.
                is Out.Err -> {
                    val hint = out.fault == Fault.Unsupported
                    label.text = if (hint) KiloBundle.message("diagram.unsupported") else KiloBundle.message("diagram.error", out.message)
                    label.foreground = if (hint) SessionUiStyle.Text.Secondary.foreground() else UiStyle.Colors.errorLabelForeground()
                    label.isVisible = true
                }
            }
            root.revalidate()
            root.repaint()
        }
    }

    render()
    ApplicationManager.getApplication().messageBus.connect(parent)
        .subscribe(EditorColorsManager.TOPIC, EditorColorsListener { ApplicationManager.getApplication().invokeLater(::render) })
    return root
}
