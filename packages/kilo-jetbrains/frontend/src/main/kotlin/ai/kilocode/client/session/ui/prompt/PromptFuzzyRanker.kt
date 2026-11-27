package ai.kilocode.client.session.ui.prompt

import com.intellij.psi.codeStyle.MinusculeMatcher
import com.intellij.psi.codeStyle.NameUtil
import com.intellij.util.text.matching.MatchingMode

internal class PromptFuzzyRanker(prefix: String) {
    private val start = matcher(prefix)
    private val middle = if (prefix.any { separator(it) }) null else matcher("*$prefix")

    fun matches(name: String, hints: List<String>): Boolean = score(name, hints) != null

    fun score(name: String, hints: List<String>): Int? = (listOf(name) + hints).maxOfOrNull { value ->
        score(value) ?: Int.MIN_VALUE
    }?.takeIf { it != Int.MIN_VALUE }

    private fun score(value: String): Int? {
        val exact = start.match(value)
        if (exact != null) return START + start.matchingDegree(value, true, exact)
        val fallback = middle ?: return null
        val fuzzy = fallback.match(value) ?: return null
        return fallback.matchingDegree(value, false, fuzzy)
    }

    private companion object {
        const val START = 10_000

        fun matcher(prefix: String): MinusculeMatcher = NameUtil.buildMatcher(prefix)
            .withMatchingMode(MatchingMode.IGNORE_CASE)
            .build()

        fun separator(c: Char): Boolean = when (c) {
            '_', '-', ':', '+', '.' -> true
            else -> c.isWhitespace()
        }
    }
}
