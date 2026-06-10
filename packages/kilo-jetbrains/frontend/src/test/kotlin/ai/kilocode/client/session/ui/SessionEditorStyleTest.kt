package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Font

@Suppress("UnstableApiUsage")
class SessionEditorStyleTest : BasePlatformTestCase() {

    fun `test transcript font uses ui family and editor size`() {
        val scheme = EditorColorsManager.getInstance().globalScheme
        val style = SessionEditorStyle.current()
        val font = style.transcriptFont

        assertEquals(UiStyle.Fonts.regular().name, font.name)
        assertEquals(scheme.editorFontSize, font.size)
        assertEquals(scheme.defaultForeground, style.editorForeground)
        assertEquals(scheme.defaultBackground, style.editorBackground)
        assertEquals(Font.PLAIN, font.style)
    }

    fun `test editor font uses editor family and size`() {
        val style = SessionEditorStyle.current()
        val font = style.editorFont

        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
        assertEquals(Font.PLAIN, font.style)
    }

    fun `test bold transcript font uses ui family and editor size`() {
        val style = SessionEditorStyle.current()
        val font = style.boldEditorFont

        assertEquals(UiStyle.Fonts.regular().name, font.name)
        assertEquals(style.editorSize, font.size)
        assertTrue(font.isBold)
    }

    fun `test small transcript font uses ui family with smaller editor-derived size`() {
        val style = SessionEditorStyle.current()
        val font = style.smallEditorFont

        assertEquals(UiStyle.Fonts.small().name, font.name)
        assertTrue(font.size < style.editorSize)
    }

    fun `test custom style keeps editor fields from supplied baseline`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)

        assertEquals("Courier New", style.editorFamily)
        assertEquals(22, style.editorSize)
        assertEquals("Courier New", style.editorFont.name)
        assertEquals(UiStyle.Fonts.regular().name, style.transcriptFont.name)
        assertEquals(22, style.transcriptFont.size)
        assertEquals(UiStyle.Fonts.regular().name, style.boldEditorFont.name)
        assertEquals(22, style.boldEditorFont.size)
        assertTrue(style.boldEditorFont.isBold)
        assertTrue(style.smallEditorFont.size < style.editorSize)
    }

    // --- UI fonts come from UiStyle.Fonts, NOT from the editor ---

    fun `test headerFont equals UiStyle Fonts header`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        assertEquals(UiStyle.Fonts.header(), style.headerFont)
    }

    fun `test hintFont equals UiStyle Fonts hint`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        assertEquals(UiStyle.Fonts.hint(), style.hintFont)
    }

    fun `test regularFont equals UiStyle Fonts regular`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        assertEquals(UiStyle.Fonts.regular(), style.regularFont)
    }

    fun `test boldFont equals UiStyle Fonts bold`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        assertEquals(UiStyle.Fonts.bold(), style.boldFont)
        assertTrue(style.boldFont.isBold)
    }

    fun `test smallFont equals UiStyle Fonts small`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        assertEquals(UiStyle.Fonts.small(), style.smallFont)
    }

    fun `test ui fonts do not use editor font family`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)

        assertFalse("headerFont should not use editor font family", style.headerFont.name == "Courier New")
        assertFalse("hintFont should not use editor font family", style.hintFont.name == "Courier New")
        assertFalse("regularFont should not use editor font family", style.regularFont.name == "Courier New")
        assertFalse("boldFont should not use editor font family", style.boldFont.name == "Courier New")
        assertFalse("smallFont should not use editor font family", style.smallFont.name == "Courier New")
    }
}
