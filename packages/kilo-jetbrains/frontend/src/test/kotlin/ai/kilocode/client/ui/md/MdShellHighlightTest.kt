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
        val display = MdShellHighlight.command("FOO=bar; git commit -m 'hello world' --amend")
        val spans = spans(display)

        assertTrue(spans.contains("git" to DefaultLanguageHighlighterColors.FUNCTION_CALL))
        assertTrue(spans.contains("-m" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("--amend" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("'hello world'" to DefaultLanguageHighlighterColors.STRING))
        assertTrue(spans.contains("FOO" to DefaultLanguageHighlighterColors.STATIC_FIELD))
    }

    private fun spans(display: ShellDisplay) = display.ranges.map {
        display.text.substring(it.start, it.end) to it.key
    }
}
