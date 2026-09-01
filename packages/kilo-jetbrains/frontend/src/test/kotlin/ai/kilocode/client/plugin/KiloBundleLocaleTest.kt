package ai.kilocode.client.plugin

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.text.MessageFormat
import java.util.Locale
import java.util.Properties

/**
 * Guards the localized empty-session tip and toolbar labels.
 *
 * The tip keys carry `{0}`/`{1}`, so they go through [MessageFormat], where a lone apostrophe
 * silently swallows the surrounding text and `''` collapses to one. Translations are easy to get
 * wrong here, so every locale is formatted for real rather than compared as a raw string.
 */
class KiloBundleLocaleTest : BasePlatformTestCase() {
    fun `test parameterized tips format cleanly in every locale`() {
        for (locale in LOCALES) {
            val props = load(locale)

            val branch = props.getProperty("session.empty.branch")
            assertNotNull("$locale: missing session.empty.branch", branch)
            assertEscaped(locale, "session.empty.branch", branch!!)
            val rendered = format(branch, "main", "LINK_PHRASE")
            assertTrue("$locale: branch tip dropped the branch name -> $rendered", rendered.contains("main"))
            assertTrue("$locale: branch tip dropped the link -> $rendered", rendered.contains("LINK_PHRASE"))
            assertClean(locale, "session.empty.branch", rendered)

            val worktree = props.getProperty("session.empty.worktree")
            assertNotNull("$locale: missing session.empty.worktree", worktree)
            assertEscaped(locale, "session.empty.worktree", worktree!!)
            val tree = format(worktree, "feature/x")
            assertTrue("$locale: worktree tip dropped the branch name -> $tree", tree.contains("feature/x"))
            assertClean(locale, "session.empty.worktree", tree)
        }
    }

    fun `test plain keys are present and carry no placeholders`() {
        for (locale in LOCALES) {
            val props = load(locale)
            for (key in PLAIN) {
                val value = props.getProperty(key)
                assertNotNull("$locale: missing $key", value)
                assertTrue("$locale: $key is blank", value!!.isNotBlank())
                assertFalse("$locale: $key should not contain a placeholder -> $value", value.contains("{0}"))
                assertFalse(
                    "$locale: $key has no placeholders so apostrophes must not be doubled -> $value",
                    value.contains("''"),
                )
            }
        }
    }

    private fun format(pattern: String, vararg args: String) =
        MessageFormat(pattern, Locale.ROOT).format(args)

    /**
     * Every apostrophe in a MessageFormat pattern must be doubled. A lone one opens a quoted run
     * that silently eats itself (and any placeholder it spans), which formatting alone will not
     * always reveal — so the raw pattern is checked directly.
     */
    private fun assertEscaped(locale: String, key: String, pattern: String) {
        for (run in Regex("'+").findAll(pattern)) {
            assertTrue(
                "$locale: $key has an unescaped apostrophe, double it -> $pattern",
                run.value.length % 2 == 0,
            )
        }
    }

    /** After formatting, MessageFormat has consumed its quoting — leftovers mean a bad pattern. */
    private fun assertClean(locale: String, key: String, rendered: String) {
        assertFalse("$locale: $key still has a doubled apostrophe -> $rendered", rendered.contains("''"))
        assertFalse("$locale: $key left an unformatted placeholder -> $rendered", rendered.contains("{"))
    }

    private fun load(locale: String): Properties {
        val name = if (locale == "en") "/messages/KiloBundle.properties" else "/messages/KiloBundle_$locale.properties"
        val stream = javaClass.getResourceAsStream(name)
        assertNotNull("$locale: $name not on the classpath", stream)
        return Properties().apply {
            InputStreamReader(stream!!, StandardCharsets.UTF_8).use { load(it) }
        }
    }

    private companion object {
        val LOCALES = listOf(
            "en", "ar", "bs", "da", "de", "es", "fr", "ja", "ko", "nl",
            "no", "pl", "pt_BR", "ru", "th", "tr", "uk", "zh_CN", "zh_TW",
        )

        val PLAIN = listOf(
            "session.empty.branch.link",
            "session.empty.worktree.unknown",
            "action.Kilo.NewSession.toolbar",
            "action.Kilo.NewWorktree.toolbar",
        )
    }
}
