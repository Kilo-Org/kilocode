package ai.kilocode.client.session.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Font
import kotlin.math.roundToInt

/** Snapshot of editor-derived transcript styling applied to live session components. */
data class SessionStyle(
    val editorScheme: EditorColorsScheme,
    val editorFamily: String,
    val editorSize: Int,
    val transcriptFont: Font,
    val smallEditorFont: Font,
    val boldEditorFont: Font,
    val uiFont: Font,
    val smallUiFont: Font,
    val boldUiFont: Font,
) {
    /** Apply this snapshot to embedded IntelliJ editor components used by session UI. */
    fun applyToEditor(editor: EditorEx) {
        editor.setColorsScheme(editorScheme)
        editor.setFontSize(editorSize)
    }

    companion object {
        fun current(): SessionStyle {
            val scheme = EditorColorsManager.getInstance().globalScheme
            return create(scheme, scheme.editorFontName, scheme.editorFontSize)
        }

        internal fun create(
            scheme: EditorColorsScheme = EditorColorsManager.getInstance().globalScheme,
            family: String = scheme.editorFontName,
            size: Int = scheme.editorFontSize,
        ): SessionStyle {
            val small = scaledSize(size, JBFont.small())
            val ui = JBUI.Fonts.label().deriveFont(size.toFloat())
            val smallUi = JBFont.small().deriveFont(small.toFloat())
            return SessionStyle(
                editorScheme = scheme,
                editorFamily = family,
                editorSize = size,
                transcriptFont = Font(family, Font.PLAIN, size),
                smallEditorFont = Font(family, Font.PLAIN, small),
                boldEditorFont = Font(family, Font.BOLD, size),
                uiFont = ui,
                smallUiFont = smallUi,
                boldUiFont = ui.deriveFont(Font.BOLD),
            )
        }

        private fun scaledSize(size: Int, font: Font): Int {
            val base = JBUI.Fonts.label().size.coerceAtLeast(1)
            val ratio = font.size.toFloat() / base
            return (size * ratio).roundToInt().coerceAtLeast(1)
        }
    }
}

/** Implemented by session components that can update styling in place. */
interface SessionStyleTarget {
    fun applyStyle(style: SessionStyle)
}
