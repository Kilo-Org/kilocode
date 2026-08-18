package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.colors.CodeInsightColors
import com.intellij.openapi.editor.colors.EditorColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.markup.TextAttributes
import java.awt.Color
import java.awt.Font

internal fun customStyle(): SessionEditorStyle {
    val scheme = EditorColorsManager.getInstance().globalScheme.clone() as EditorColorsScheme
    scheme.setAttributes(
        HighlighterColors.TEXT,
        TextAttributes(Color(0x10, 0x20, 0x30), Color(0x01, 0x02, 0x03), null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        DefaultLanguageHighlighterColors.DOC_COMMENT,
        TextAttributes(Color(0x33, 0x44, 0x55), null, null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        DefaultLanguageHighlighterColors.LINE_COMMENT,
        TextAttributes(Color(0x44, 0x55, 0x66), null, null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        DefaultLanguageHighlighterColors.DOC_CODE_INLINE,
        TextAttributes(Color(0xAA, 0xBB, 0xCC), Color(0x11, 0x22, 0x33), null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        DefaultLanguageHighlighterColors.STRING,
        TextAttributes(Color(0xCC, 0x88, 0x66), null, null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        DefaultLanguageHighlighterColors.DOC_CODE_BLOCK,
        TextAttributes(Color(0xDD, 0xEE, 0xFF), Color(0x44, 0x55, 0x66), null, null, Font.PLAIN),
    )
    scheme.setAttributes(
        CodeInsightColors.HYPERLINK_ATTRIBUTES,
        TextAttributes(Color(0x77, 0x88, 0x99), null, null, null, Font.PLAIN),
    )
    scheme.setColor(EditorColors.PREVIEW_BORDER_COLOR, Color(0x22, 0x33, 0x44))
    return SessionEditorStyle.create(scheme = scheme, family = "Courier New", size = 21)
}
