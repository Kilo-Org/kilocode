package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.HoverIcon
import com.intellij.icons.AllIcons
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Cursor
import java.awt.Point
import java.awt.datatransfer.StringSelection
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

internal class SessionCopyButton(
    fill: Boolean = false,
    private val text: () -> String?,
) {
    private var balloon: Balloon? = null
    val button = HoverIcon(fill = fill).apply {
        icon = AllIcons.Actions.Copy
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("session.copy.hover")
    }

    init {
        button.addActionListener { copy() }
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
}
