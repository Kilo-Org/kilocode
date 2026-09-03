package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.copyImage
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
import java.awt.image.BufferedImage
import javax.swing.Icon

internal class SessionCopyButton(
    fill: Boolean = false,
    tooltip: String = KiloBundle.message("session.copy.hover"),
    icon: Icon = COPY_ICON,
    private val image: () -> BufferedImage? = { null },
    private val text: () -> String?,
) {
    private var balloon: Balloon? = null
    val button = toolbarButton(
        ToolbarButtonAction(
            icon,
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
        if (!put()) return
        dismiss()
        balloon = JBPopupFactory.getInstance()
            .createHtmlTextBalloonBuilder(KiloBundle.message("session.copy.copied"), null, null, null)
            .createBalloon()
            .also { item ->
                item.setAnimationEnabled(false)
                item.show(RelativePoint(button, Point(button.width / 2, 0)), Balloon.Position.above)
            }
    }

    /**
     * Writes the clipboard and reports whether anything was put there.
     *
     * A picture wins over text, so a rendered diagram is pasted as an image while everything else (and
     * a diagram that is still streaming or failed to render) keeps copying its text.
     */
    @RequiresEdt
    private fun put(): Boolean {
        val picture = image()
        if (picture != null) {
            copyImage(picture)
            return true
        }
        val value = text()?.takeIf { it.isNotEmpty() } ?: return false
        CopyPasteManager.getInstance().setContents(StringSelection(value))
        return true
    }

    companion object {
        private val COPY_ICON: Icon = IconLoader.getIcon("/icons/copy.svg", SessionCopyButton::class.java)
    }
}
