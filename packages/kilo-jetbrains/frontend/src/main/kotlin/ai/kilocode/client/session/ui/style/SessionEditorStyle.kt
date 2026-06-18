package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.util.ui.JBFont
import java.awt.Color
import java.awt.Font
import kotlin.math.roundToInt

/**
 * Immutable snapshot of editor-derived fonts and colors for transcript components.
 *
 * Session UI uses this instead of reading editor globals in every component so font and color changes can be applied
 * consistently through [SessionEditorStyleTarget].
 *
 * Editor-specific fields ([editorFont], [editorForeground], [editorBackground]) are derived from the active editor color
 * scheme and are used for code/editor-rendered content.
 *
 * UI font fields ([transcriptFont], [smallEditorFont], [boldEditorFont], [headerFont], [hintFont], [regularFont],
 * [boldFont], [smallFont]) come from [UiStyle.Fonts] and follow standard platform typography. Transcript fonts use the
 * editor size so the session body tracks editor zoom without adopting the editor family.
 */
data class SessionEditorStyle(
    val editorScheme: EditorColorsScheme,
    val editorFamily: String,
    val editorSize: Int,
    val editorForeground: Color,
    val editorBackground: Color,
    val editorFont: Font,
    val transcriptFont: Font,
    val smallEditorFont: Font,
    val boldEditorFont: Font,
    val headerFont: Font,
    val hintFont: Font,
    val regularFont: Font,
    val boldFont: Font,
    val smallFont: Font,
) {
    /** Apply this snapshot to embedded IntelliJ editor components used by session UI. */
    fun applyToEditor(editor: EditorEx) {
        try {
            if (editor.isDisposed) return
            editor.setColorsScheme(editorScheme)
            editor.setFontSize(editorSize)
        } catch (err: RuntimeException) {
            if (err.javaClass.name != "com.intellij.openapi.util.TraceableDisposable\$DisposalException") throw err
        }
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
            val small = scaledEditorSize(size, JBFont.small())
            return SessionEditorStyle(
                editorScheme = scheme,
                editorFamily = family,
                editorSize = size,
                editorForeground = scheme.defaultForeground,
                editorBackground = scheme.defaultBackground,
                editorFont = Font(family, Font.PLAIN, size),
                transcriptFont = uiFont(UiStyle.Fonts.regular(), Font.PLAIN, size),
                smallEditorFont = uiFont(UiStyle.Fonts.small(), Font.PLAIN, small),
                boldEditorFont = uiFont(UiStyle.Fonts.regular(), Font.BOLD, size),
                headerFont = UiStyle.Fonts.header(),
                hintFont = UiStyle.Fonts.hint(),
                regularFont = UiStyle.Fonts.regular(),
                boldFont = UiStyle.Fonts.bold(),
                smallFont = UiStyle.Fonts.small(),
            )
        }

        private fun scaledEditorSize(size: Int, font: Font): Int {
            val base = com.intellij.util.ui.JBUI.Fonts.label().size.coerceAtLeast(1)
            val ratio = font.size.toFloat() / base
            return (size * ratio).roundToInt().coerceAtLeast(1)
        }

        private fun uiFont(font: Font, style: Int, size: Int): Font = font.deriveFont(style, size.toFloat())
    }
}

/** Session component contract for applying a refreshed [SessionEditorStyle] without rebuilding Swing nodes. */
interface SessionEditorStyleTarget {
    fun applyStyle(style: SessionEditorStyle)
}
