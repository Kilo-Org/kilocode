package ai.kilocode.client.ui.md.hybrid

import com.intellij.openapi.diff.DiffColors
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdDiffHighlightTest : BasePlatformTestCase() {

    fun `test inserted line whose content starts with plus plus is not dimmed as a header`() {
        // "++x;" is an inserted line ("+" marker + "+x;" content), not a "+++" file header.
        val out = MdDiffHighlight.display("++x;")

        assertEquals(1, out.spans.size)
        assertEquals(DiffColors.DIFF_INSERTED, out.spans.single().span.key)
    }

    fun `test deleted line whose content starts with a dash is not dimmed as a header`() {
        // "--x" is a deleted line ("-" marker + "-x" content), not a "---" file header.
        val out = MdDiffHighlight.display("--x")

        assertEquals(1, out.spans.size)
        assertEquals(DiffColors.DIFF_DELETED, out.spans.single().span.key)
    }

    fun `test real file headers are dimmed as comments`() {
        val out = MdDiffHighlight.display("--- a/File.kt\n+++ b/File.kt")

        assertEquals(2, out.spans.size)
        assertTrue(out.spans.all { it.span.key == DefaultLanguageHighlighterColors.LINE_COMMENT })
    }
}
