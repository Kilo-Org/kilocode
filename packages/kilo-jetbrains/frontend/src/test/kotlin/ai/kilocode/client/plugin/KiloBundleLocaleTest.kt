package ai.kilocode.client.plugin

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.text.MessageFormat
import java.util.Locale
import java.util.Properties
import kotlin.io.path.extension
import kotlin.io.path.readText

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

    fun `test background agent controls are translated and format in every locale`() {
        for (locale in LOCALES) {
            val props = load(locale)
            for ((key, marker) in AGENT) {
                val pattern = props.getProperty(key)
                assertNotNull("$locale: missing $key", pattern)
                assertEscaped(locale, key, pattern!!)
                val rendered = format(pattern, marker)
                assertTrue("$locale: $key dropped its argument -> $rendered", rendered.contains(marker))
                assertClean(locale, key, rendered)
            }
            for (key in AGENT_PLAIN) {
                val value = props.getProperty(key)
                assertNotNull("$locale: missing $key", value)
                assertTrue("$locale: $key is blank", value!!.isNotBlank())
                assertFalse("$locale: $key should not contain a placeholder -> $value", value.contains("{0}"))
            }

            val summary = props.getProperty("session.header.agents.summary")
            assertNotNull("$locale: missing session.header.agents.summary", summary)
            assertEscaped(locale, "session.header.agents.summary", summary!!)
            val renderedSummary = format(summary, "RUNNING_COUNT", "TOTAL_COUNT")
            assertTrue(
                "$locale: session.header.agents.summary dropped the running count -> $renderedSummary",
                renderedSummary.contains("RUNNING_COUNT"),
            )
            assertTrue(
                "$locale: session.header.agents.summary dropped the total count -> $renderedSummary",
                renderedSummary.contains("TOTAL_COUNT"),
            )
            assertClean(locale, "session.header.agents.summary", renderedSummary)
        }
    }

    fun `test 7 1 7 release keys are present and format in every locale`() {
        for (locale in LOCALES) {
            val props = load(locale)
            for ((key, args) in RELEASE_7_1_7) {
                val pattern = props.getProperty(key)
                assertNotNull("$locale: missing $key", pattern)
                assertTrue("$locale: $key is blank", pattern!!.isNotBlank())
                assertEscaped(locale, key, pattern)
                val rendered = format(pattern, *args.toTypedArray())
                for (arg in args) {
                    assertTrue("$locale: $key dropped $arg -> $rendered", rendered.contains(arg))
                }
                assertClean(locale, key, rendered)
            }
        }
    }

    fun `test localized bundles do not carry stale keys`() {
        val base = load("en").stringPropertyNames()
        for (locale in LOCALES.filterNot { it == "en" }) {
            val props = load(locale)
            for (key in props.stringPropertyNames()) {
                assertTrue("$locale: stale localized key $key", key in base)
            }
        }
    }

    fun `test source bundle literals exist in base bundle`() {
        val base = load("en").stringPropertyNames()
        val missing = bundleKeys().filter { "$" !in it }.filter { it !in base }.sorted()

        assertTrue("Missing base bundle keys: $missing", missing.isEmpty())
    }

    fun `test source scan keeps every when branch after comma separated conditions`() {
        val source = """
            KiloBundle.message(
                when (value) {
                    Mode.FIRST, Mode.SECOND -> "bundle.choice"
                    else -> "bundle.fallback"
                },
                "FORMAT_ARG",
            )
        """.trimIndent()

        assertEquals(setOf("bundle.choice", "bundle.fallback"), extractKeys(source))
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

    private fun bundleKeys(): Set<String> {
        val keys = mutableSetOf<String>()
        Files.walk(sourceRoot()).use { stream ->
            stream
                .filter { it.extension == "kt" }
                .forEach { path -> keys += extractKeys(path.readText()) }
        }
        return keys
    }

    /**
     * Every string literal that could be the key argument of a `KiloBundle.message(...)` or
     * `KiloBundle.optional(...)` call in [text].
     *
     * Call sites are not always `KiloBundle.message("literal")` on one line: the key argument can
     * span multiple lines, and can itself be an `if`/`when` expression choosing between two or more
     * literal keys (see `BackgroundAgentStrip.overflow`, `SkillsConfigurable.sourceDialogTitle`). A
     * plain single-line regex misses both, so this walks each call's balanced parentheses instead:
     * it finds the call's first top-level argument (the key expression, delimited by the call's own
     * parens and its first top-level comma) and pulls every quoted literal out of just that
     * argument — never a later format-args literal, like the elvis fallback in
     * `KiloBundle.message(key, target?.displayPath ?: "...")`, which is a value, not a key.
     */
    private fun extractKeys(text: String): Set<String> {
        val keys = mutableSetOf<String>()
        for (match in CALL.findAll(text)) {
            val open = match.range.last
            val close = matchingParen(text, open) ?: continue
            val keyExpr = firstArgument(text, open, close)
            LITERAL.findAll(keyExpr).forEach { keys.add(it.groupValues[1]) }
        }
        return keys
    }

    /** Index of the `)` balancing the `(` at [open] in [text], skipping over string literals. */
    private fun matchingParen(text: String, open: Int): Int? {
        var depth = 1
        var i = open + 1
        while (i < text.length) {
            when (text[i]) {
                '"' -> i = skipString(text, i)
                '(' -> depth++
                ')' -> {
                    depth--
                    if (depth == 0) return i
                }
            }
            i++
        }
        return null
    }

    /** Index of the closing quote of the string literal starting at index [start]. */
    private fun skipString(text: String, start: Int): Int {
        var i = start + 1
        while (i < text.length && text[i] != '"') {
            if (text[i] == '\\') i++
            i++
        }
        return i
    }

    /**
     * The call's first top-level argument, between its `(` at [open] and either its first
     * top-level comma or its closing `)` at [close] — i.e. the key expression, excluding any
     * later format-args. Parentheses, braces, and brackets can all contain nested commas.
     */
    private fun firstArgument(text: String, open: Int, close: Int): String {
        var parens = 0
        var braces = 0
        var brackets = 0
        var i = open + 1
        while (i < close) {
            when (text[i]) {
                '"' -> i = skipString(text, i)
                '(' -> parens++
                ')' -> parens--
                '{' -> braces++
                '}' -> braces--
                '[' -> brackets++
                ']' -> brackets--
                ',' -> if (parens == 0 && braces == 0 && brackets == 0) return text.substring(open + 1, i)
            }
            i++
        }
        return text.substring(open + 1, close)
    }

    private fun sourceRoot(): Path {
        val dir = Path.of(System.getProperty("user.dir"))
        val candidates = listOf(
            dir.resolve("src/main/kotlin"),
            dir.resolve("frontend/src/main/kotlin"),
            dir.resolve("packages/kilo-jetbrains/frontend/src/main/kotlin"),
        )
        return candidates.firstOrNull { Files.isDirectory(it) }
            ?: error("could not locate frontend src/main/kotlin from $dir")
    }

    private companion object {
        val CALL = Regex("""KiloBundle\.(?:message|optional)\(""")
        val LITERAL = Regex(""""([^"\\]*(?:\\.[^"\\]*)*)"""")

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

        val AGENT = mapOf(
            "session.header.agents.open" to "AGENT_NAME",
            "session.header.agents.more.many" to "7",
            "session.header.agents.more.accessible.many" to "7",
            "session.header.agents.running.many" to "7",
        )

        val AGENT_PLAIN = listOf(
            "session.header.agents.more.one",
            "session.header.agents.more.accessible.one",
            "session.header.agents.running.one",
        )

        val RELEASE_7_1_7 = mapOf(
            "session.part.tool.continueInBackground" to emptyList<String>(),
            "session.header.agents.toggle" to emptyList(),
            "session.header.agents.waiting" to emptyList(),
            "session.header.agents.needsInput" to emptyList(),
            "session.header.agents.untitled" to emptyList(),
            "session.header.agents.openAll" to emptyList(),
            "session.header.agents.stop" to emptyList(),
            "session.header.agents.stopAll" to listOf("STOP_COUNT"),
            "session.header.agents.dismiss" to emptyList(),
            "session.header.agents.clearFinished" to emptyList(),
            "session.header.agents.status.running" to emptyList(),
            "session.header.agents.status.completed" to emptyList(),
            "session.header.agents.status.cancelled" to emptyList(),
            "session.header.agents.status.error" to emptyList(),
            "session.header.agents.disabledTitle" to emptyList(),
            "session.header.agents.disabledMessage" to emptyList(),
            "prompt.paste.collapsed" to listOf("PASTE_LINES"),
            "worktree.delete.nested.copyPath" to emptyList(),
            "worktree.delete.nested.reveal.failed.title" to emptyList(),
            "worktree.delete.nested.reveal.failed.detail" to emptyList(),
            "worktree.run.section.unsupported" to listOf("UNSUPPORTED_COUNT"),
            "worktree.run.unsupported.item" to listOf("CONFIG_NAME", "SKIP_REASON"),
            "worktree.import.pr.foreign" to listOf("PR_REPO", "ORIGIN_REPO"),
            "worktree.gh.timeout.title" to emptyList(),
            "worktree.gh.timeout.content" to emptyList(),
            "worktree.stats.unavailable" to emptyList(),
            "worktree.diagnostics.title" to emptyList(),
            "worktree.diagnostics.description" to emptyList(),
            "worktree.diagnostics.copy" to emptyList(),
            "worktree.diagnostics.copied" to emptyList(),
            "worktree.diagnostics.noProject" to emptyList(),
            "settings.agentBehavior.extended.title" to emptyList(),
        )
    }
}
