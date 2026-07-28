package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.toolbarButton
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.datatransfer.StringSelection
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon

internal class SessionCopyButton(
    fill: Boolean = false,
    tooltip: String = KiloBundle.message("session.copy.hover"),
    private val text: () -> String?,
) {
    private var balloon: Balloon? = null
    val button = toolbarButton(
        ToolbarButtonAction(
            COPY_ICON,
            tooltip,
        ) { copy() },
        fill,
    )

    init {
        button.addMouseListener(object : MouseAdapter() {
            override fun mouseExited(e: MouseEvent) {
                dismiss()
            }
        })
    }

    @RequiresEdt
    fun dismiss() {
        balloon?.hide()
        balloon = null
    }

    @RequiresEdt
    fun copy() {
        val value = text()?.takeIf { it.isNotEmpty() } ?: return
        CopyPasteManager.getInstance().setContents(StringSelection(value))
        dismiss()
        balloon = JBPopupFactory.getInstance()
            .createHtmlTextBalloonBuilder(KiloBundle.message("session.copy.copied"), null, null, null)
            .createBalloon()
            .also { item ->
                item.setAnimationEnabled(false)
                item.show(RelativePoint(button, Point(button.width / 2, 0)), Balloon.Position.above)
            }
    }

    companion object {
        private val COPY_ICON: Icon = IconLoader.getIcon("/icons/copy.svg", SessionCopyButton::class.java)
    }
}
