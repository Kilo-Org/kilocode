package ai.kilocode.client.session.context

import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile

/**
 * Minimal `.gitignore`-style matcher used to keep ignored or sensitive files out
 * of the editor context sent to the model.
 *
 * Mirrors the VS Code `FileIgnoreController` precedence:
 *  - if `.kilocodeignore` exists and is non-empty, use only its patterns (plus the
 *    `.kilocodeignore` file itself);
 *  - otherwise fall back to `.gitignore` plus the sensitive `.env` / `.env.*`
 *    patterns.
 *
 * Paths are matched as workspace-relative POSIX paths. Only the subset of gitignore
 * syntax relevant to path filtering is supported: comments (`#`), blank lines,
 * negation (`!`), anchoring (leading or embedded `/`), directory-only (trailing
 * `/`), and the `*`, `**`, `?`, and `[..]` globs.
 */
internal class KiloIgnore private constructor(private val rules: List<Rule>) {

    /** True when [path] (workspace-relative) should be excluded from editor context. */
    fun ignored(path: String): Boolean {
        val norm = path.replace('\\', '/').trim('/')
        if (norm.isEmpty()) return false
        var hit = false
        for (rule in rules) {
            if (rule.regex.matches(norm)) hit = !rule.negate
        }
        return hit
    }

    private class Rule(val regex: Regex, val negate: Boolean)

    companion object {
        val EMPTY = KiloIgnore(emptyList())

        const val KILO = ".kilocodeignore"
        const val GIT = ".gitignore"
        private val SENSITIVE = listOf(".env", ".env.*")

        /**
         * Builds the matcher from the ignore files under [root]. Reads through the VFS
         * so it works in remote/split mode where the workspace lives on the host.
         * Returns [EMPTY] (allow-all) when [root] is null or unreadable; the backend
         * permission layer still guards file contents.
         */
        fun load(root: VirtualFile?): KiloIgnore {
            if (root == null) return EMPTY
            val kilo = read(root, KILO)
            if (!kilo.isNullOrBlank()) return KiloIgnore(compile(kilo) + compile(KILO))
            val rules = mutableListOf<Rule>()
            read(root, GIT)?.takeIf { it.isNotBlank() }?.let { rules += compile(it) }
            rules += SENSITIVE.mapNotNull { rule(it) }
            return KiloIgnore(rules)
        }

        /** Test seam: build a matcher directly from ignore-file text. */
        fun of(text: String): KiloIgnore = KiloIgnore(compile(text))

        private fun read(root: VirtualFile, name: String): String? {
            val file = root.findChild(name) ?: return null
            if (!file.isValid || file.isDirectory) return null
            return runCatching { VfsUtilCore.loadText(file) }.getOrNull()
        }

        private fun compile(text: String): List<Rule> = text.lineSequence().mapNotNull { rule(it) }.toList()

        private fun rule(raw: String): Rule? {
            var line = raw.trimEnd()
            if (line.isEmpty() || line.startsWith("#")) return null
            val negate = line.startsWith("!")
            if (negate) line = line.substring(1)
            val dirOnly = line.endsWith("/")
            if (dirOnly) line = line.trimEnd('/')
            val leading = line.startsWith("/")
            if (leading) line = line.trimStart('/')
            if (line.isEmpty()) return null
            val anchored = leading || line.contains('/')
            val prefix = if (anchored) "" else "(?:.*/)?"
            val suffix = if (dirOnly) "/.*" else "(?:/.*)?"
            // A malformed character class (e.g. `[]`, `[z-a]`) yields an invalid Java regex.
            // Skip the bad rule instead of letting PatternSyntaxException break every prompt send.
            val regex = runCatching { Regex("^$prefix${glob(line)}$suffix$") }.getOrNull() ?: return null
            return Rule(regex, negate)
        }

        private fun glob(glob: String): String {
            val sb = StringBuilder()
            var i = 0
            while (i < glob.length) {
                val c = glob[i]
                when (c) {
                    '\\' -> {
                        val next = glob.getOrNull(i + 1)
                        if (next == null) sb.append("\\\\")
                        else {
                            if (!next.isLetterOrDigit()) sb.append('\\')
                            sb.append(next)
                            i++
                        }
                    }

                    '*' -> {
                        if (glob.getOrNull(i + 1) == '*') {
                            i++
                            if (glob.getOrNull(i + 1) == '/') {
                                sb.append("(?:.*/)?")
                                i++
                            } else {
                                sb.append(".*")
                            }
                        } else {
                            sb.append("[^/]*")
                        }
                    }

                    '?' -> sb.append("[^/]")

                    '[' -> {
                        val end = glob.indexOf(']', i + 1)
                        if (end == -1) {
                            sb.append("\\[")
                        } else {
                            val body = glob.substring(i + 1, end)
                            sb.append('[').append(if (body.startsWith("!")) "^${body.substring(1)}" else body).append(']')
                            i = end
                        }
                    }

                    '.', '(', ')', '+', '|', '^', '$', '{', '}', ']' -> sb.append('\\').append(c)

                    else -> sb.append(c)
                }
                i++
            }
            return sb.toString()
        }
    }
}
