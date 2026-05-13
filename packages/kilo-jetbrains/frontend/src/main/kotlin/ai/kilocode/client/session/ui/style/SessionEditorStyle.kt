package ai.kilocode.client.session.ui.style

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Font
import kotlin.math.roundToInt

/**
 * Immutable snapshot of editor-derived fonts and colors for transcript components.
 *
 * Session UI uses this instead of reading editor globals in every component so font and color changes can be applied
 * consistently through [SessionEditorStyleTarget].
 */
data class SessionEditorStyle(
    val editorScheme: EditorColorsScheme,
    val editorFamily: String,
    val editorSize: Int,
    val editorForeground: Color,
    val editorBackground: Color,
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
        /** Builds a style snapshot from the current global editor color scheme. */
        fun current(): SessionEditorStyle {
            val scheme = EditorColorsManager.getInstance().globalScheme
            return create(scheme, scheme.editorFontName, scheme.editorFontSize)
        }

        internal fun create(
            scheme: EditorColorsScheme = EditorColorsManager.getInstance().globalScheme,
            family: String = scheme.editorFontName,
            size: Int = scheme.editorFontSize,
        ): SessionEditorStyle {
            val small = scaledSize(size, JBFont.small())
            val ui = JBUI.Fonts.label().deriveFont(size.toFloat())
            val smallUi = JBFont.small().deriveFont(small.toFloat())
            return SessionEditorStyle(
                editorScheme = scheme,
                editorFamily = family,
                editorSize = size,
                editorForeground = scheme.defaultForeground,
                editorBackground = scheme.defaultBackground,
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

/** Session component contract for applying a refreshed [SessionEditorStyle] without rebuilding Swing nodes. */
interface SessionEditorStyleTarget {
    fun applyStyle(style: SessionEditorStyle)
}
