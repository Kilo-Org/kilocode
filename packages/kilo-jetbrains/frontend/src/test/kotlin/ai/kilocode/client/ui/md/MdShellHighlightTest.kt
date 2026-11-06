package ai.kilocode.client.ui.md

import ai.kilocode.client.ui.md.hybrid.MdShellHighlight
import ai.kilocode.client.ui.md.hybrid.ShellDisplay
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdShellHighlightTest : BasePlatformTestCase() {
    fun `test project groups git stat commits and highlights semantic ranges`() {
        val display = MdShellHighlight.project(
            """
                475ab514 (HEAD -> main, origin/main) First change
                 src/App.kt | 2 ++
                1 file changed, 1 insertion(+), 1 deletion(-)
                e8b9785 Second change
                 src/Other.kt | 7 +++----
                1 file changed, 3 insertions(+), 1 deletion(-)
                <shell_metadata>
                </shell_metadata>
                ...output truncated...
            """.trimIndent(),
        )
        val spans = spans(display)

        assertTrue(display.text.contains("1 deletion(-)\n\ne8b9785"))
        assertTrue(spans.contains("475ab514" to DefaultLanguageHighlighterColors.NUMBER))
        assertTrue(spans.contains("(HEAD -> main, origin/main)" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("1 insertion(+)" to DefaultLanguageHighlighterColors.STRING))
        assertTrue(spans.contains("1 deletion(-)" to DefaultLanguageHighlighterColors.LINE_COMMENT))
        assertTrue(spans.contains("++" to DefaultLanguageHighlighterColors.STRING))
        assertTrue(spans.contains("----" to DefaultLanguageHighlighterColors.LINE_COMMENT))
        assertTrue(spans.contains("<shell_metadata>" to DefaultLanguageHighlighterColors.DOC_COMMENT))
        assertTrue(spans.contains("...output truncated..." to DefaultLanguageHighlighterColors.KEYWORD))
    }

    fun `test command highlights commands flags strings and env vars`() {
        val display = MdShellHighlight.command("$ FOO=bar; git commit -m 'hello world' --amend")
        val spans = spans(display)

        assertTrue(spans.contains("git" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("-m" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("--amend" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("'hello world'" to DefaultLanguageHighlighterColors.STRING))
        assertTrue(spans.contains("FOO" to DefaultLanguageHighlighterColors.STATIC_FIELD))
    }

    fun `test ranges reads unclosed parentheses in linear time`() {
        // An unclosed "(" followed by many lines made the git refs pattern backtrack cubically (#15507).
        val text = "error (see details\n" + "src/main/kotlin/File.kt\n".repeat(400)
        val input = ReadBudget(text, budget = text.length * 50)

        MdShellHighlight.ranges(input)

        assertTrue("read ${input.reads} chars for ${text.length} chars of input", input.reads <= input.budget)
    }

    fun `test ranges highlights git refs only`() {
        val display = MdShellHighlight.project("abc1234 (HEAD -> main, origin/main) fix (see notes) for (feature/x)")
        val spans = spans(display).filter { it.second == DefaultLanguageHighlighterColors.KEYWORD }.map { it.first }

        assertEquals(listOf("(HEAD -> main, origin/main)", "(feature/x)"), spans)
    }

    /** Fails fast once the regex engine reads more characters than [budget]. */
    private class ReadBudget(private val text: String, val budget: Int) : CharSequence {
        var reads = 0
            private set

        override val length get() = text.length

        override fun get(index: Int): Char {
            reads++
            if (reads > budget) throw AssertionError("read more than $budget chars for ${text.length} chars of input")
            return text[index]
        }

        override fun subSequence(startIndex: Int, endIndex: Int) = text.subSequence(startIndex, endIndex)

        override fun toString() = text
    }

    private fun spans(display: ShellDisplay) = display.ranges.map {
        display.text.substring(it.start, it.end) to it.key
    }
}
