package ai.kilocode.client.session.ui.search

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class TranscriptMatcherTest : BasePlatformTestCase() {
    private fun deadline(): Long = System.nanoTime() + 5_000_000_000

    private fun ranges(text: String, options: TranscriptMatchOptions): List<String> {
        val result = TranscriptMatcher.matches(text, options, deadline()) { false }
        assertTrue(result is TranscriptMatchResult.Matches)
        return (result as TranscriptMatchResult.Matches).ranges.map { text.substring(it.startOffset, it.endOffset) }
    }

    fun `test literal search is case insensitive by default`() {
        assertEquals(listOf("Foo", "foo", "FOO"), ranges("Foo foo FOO", TranscriptMatchOptions("foo")))
    }

    fun `test case sensitive search respects the option`() {
        assertEquals(listOf("Foo"), ranges("Foo foo FOO", TranscriptMatchOptions("Foo", caseSensitive = true)))
    }

    fun `test whole words use identifier boundaries and punctuation tokens`() {
        val text = "foo foo_bar barfoo (foo) foo. foo-foo"
        assertEquals(
            listOf("foo", "foo", "foo", "foo", "foo"),
            ranges(text, TranscriptMatchOptions("foo", wholeWords = true)),
        )
    }

    fun `test regex search supports case insensitive matching`() {
        assertEquals(listOf("Foo", "foo"), ranges("Foo foo", TranscriptMatchOptions("f.o", regex = true)))
    }

    fun `test invalid regex is reported`() {
        assertEquals(
            TranscriptMatchResult.InvalidRegex,
            TranscriptMatcher.matches("[", TranscriptMatchOptions("[", regex = true), deadline()) { false },
        )
    }

    fun `test zero width regex always advances`() {
        assertEquals(listOf("", "", ""), ranges("aaa", TranscriptMatchOptions("(?=a)", regex = true)))
    }

    fun `test zero width regex at end of text is safe`() {
        assertEquals(listOf(""), ranges("abc", TranscriptMatchOptions("(?=$)", regex = true)))
    }

    fun `test cancellation is reported before work starts`() {
        assertEquals(
            TranscriptMatchResult.Cancelled,
            TranscriptMatcher.matches("text", TranscriptMatchOptions("text"), deadline()) { true },
        )
    }

    fun `test an expired deadline is reported`() {
        assertEquals(
            TranscriptMatchResult.TimedOut,
            TranscriptMatcher.matches("text", TranscriptMatchOptions("text"), System.nanoTime() - 1) { false },
        )
    }
}