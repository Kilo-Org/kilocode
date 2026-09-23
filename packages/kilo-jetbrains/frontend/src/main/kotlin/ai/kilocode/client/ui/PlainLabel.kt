package ai.kilocode.client.ui

import com.intellij.ui.components.JBLabel
import java.awt.Font
import java.awt.Graphics
import java.awt.font.TextAttribute

/**
 * A [JBLabel] that always paints its text verbatim, never as HTML, with optional underline and strikethrough.
 *
 * Swing rebuilds the private HTML document of an `<html>` label whenever the label's graphics configuration
 * changes, and a component leaving or joining the hierarchy counts as a change (`BasicLabelUI.propertyChange`
 * through `SwingUtilities2.isScaleChanged`). Editor tabs detach the hidden tab's component on every switch, so a
 * transcript made of HTML labels re-parsed every one of them twice per tab switch. Plain text has no such cost,
 * and the decorations that markup used to provide are painted from font attributes instead.
 *
 * HTML rendering is disabled outright, so text that happens to start with `<html>` (a shell command, a file name)
 * still shows literally and needs no escaping.
 */
open class PlainLabel(text: String = "") : JBLabel() {
    var underline = false
        set(value) {
            if (field == value) return
            field = value
            restyle()
        }

    var strike = false
        set(value) {
            if (field == value) return
            field = value
            restyle()
        }

    // The last font decorated for painting and its result, so painting does not derive a new font per frame.
    private var base: Font? = null
    private var styled: Font? = null

    init {
        putClientProperty(HTML_DISABLE, true)
        this.text = text
    }

    /**
     * Decorates only the paint graphics. [getFont] stays the assigned font, so font comparisons, style sync and
     * size math are unaffected; underline and strikethrough do not change glyph advances, so sizes still match.
     */
    override fun getComponentGraphics(g: Graphics): Graphics {
        val out = super.getComponentGraphics(g)
        if (!underline && !strike) return out
        out.font = decorate(out.font ?: return out)
        return out
    }

    private fun decorate(font: Font): Font {
        val cached = styled
        if (font === base && cached != null) return cached
        val attrs = buildMap<TextAttribute, Any> {
            if (underline) put(TextAttribute.UNDERLINE, TextAttribute.UNDERLINE_ON)
            if (strike) put(TextAttribute.STRIKETHROUGH, TextAttribute.STRIKETHROUGH_ON)
        }
        return font.deriveFont(attrs).also {
            base = font
            styled = it
        }
    }

    private fun restyle() {
        base = null
        styled = null
        repaint()
    }

    private companion object {
        /** Client property honored by `BasicHTML.updateRenderer`: never build an HTML view for this label. */
        const val HTML_DISABLE = "html.disable"
    }
}

/** Collapses [value] onto one line: trims each line, drops blank ones and joins the rest with single spaces. */
internal fun oneLine(value: String): String = value.lineSequence()
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .joinToString(" ")
