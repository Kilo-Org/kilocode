package ai.kilocode.client.session.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Font

@Suppress("UnstableApiUsage")
class SessionStyleTest : BasePlatformTestCase() {

    fun `test transcript font uses editor settings`() {
        val scheme = EditorColorsManager.getInstance().globalScheme
        val style = SessionStyle.current()
        val font = style.transcriptFont

        assertEquals(scheme.editorFontName, font.name)
        assertEquals(scheme.editorFontSize, font.size)
        assertEquals(Font.PLAIN, font.style)
    }

    fun `test bold editor font uses editor family and size`() {
        val style = SessionStyle.current()
        val font = style.boldEditorFont

        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
        assertTrue(font.isBold)
    }

    fun `test small editor font uses editor family with smaller editor-derived size`() {
        val style = SessionStyle.current()
        val font = style.smallEditorFont

        assertEquals(style.editorFamily, font.name)
        assertTrue(font.size < style.editorSize)
    }

    fun `test custom style derives fonts from supplied editor baseline`() {
        val style = SessionStyle.create(family = "Courier New", size = 22)

        assertEquals("Courier New", style.editorFamily)
        assertEquals(22, style.editorSize)
        assertEquals("Courier New", style.transcriptFont.name)
        assertEquals(22, style.transcriptFont.size)
        assertEquals("Courier New", style.boldEditorFont.name)
        assertEquals(22, style.boldEditorFont.size)
        assertTrue(style.boldEditorFont.isBold)
        assertTrue(style.smallEditorFont.size < style.editorSize)
        assertEquals(style.editorSize, style.uiFont.size)
    }
}
