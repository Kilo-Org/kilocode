package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import com.intellij.openapi.Disposable
import java.awt.Color
import java.awt.Component
import java.awt.Font
import java.awt.Point
import javax.swing.JComponent

/** Markdown rendering component. All public methods must be called on the EDT. */
interface MdView : Disposable {
    val component: JComponent

    fun set(text: String)
    fun append(delta: String)
    fun clear()
    fun applyStyle(style: SessionEditorStyle)
    fun setSelection(selection: SessionSelection?)
    fun resetStyles()
    fun addLinkListener(listener: LinkListener)
    fun removeLinkListener(listener: LinkListener)

    var font: Font
    var foreground: Color
    var background: Color
    var linkColor: Color
    var codeBg: Color
    var preBg: Color
    var preFg: Color
    var codeFont: String
    var quoteBorder: Color
    var quoteFg: Color
    var tableBorder: Color
    var opaque: Boolean

    data class LinkEvent(
        val href: String,
        val point: Point? = null,
        val component: Component? = null,
    )

    fun interface LinkListener {
        fun onLink(event: LinkEvent)
    }

    fun markdown(): String
    fun html(): String
    fun overrideSheet(): String
    fun simulateLink(href: String)
}
