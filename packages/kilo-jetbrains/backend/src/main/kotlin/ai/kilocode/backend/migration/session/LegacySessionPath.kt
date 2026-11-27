package ai.kilocode.backend.migration.session

import java.io.File
import java.nio.file.Paths

/**
 * Path normalization for legacy workspace paths.
 *
 * Port of packages/kilo-vscode/src/legacy-migration/sessions/lib/path.ts
 */
object LegacySessionPath {

    fun normalize(input: String?): String {
        val raw = input?.trim() ?: return ""
        if (raw.isEmpty()) return ""
        val resolved = Paths.get(raw).normalize().toAbsolutePath().toString()
        val canonical = normalizeWindowsDriveLetter(resolved)
        return runCatching { File(canonical).canonicalPath }.getOrElse { canonical }
    }

    private fun normalizeWindowsDriveLetter(input: String): String {
        val drivePath = Regex("^[a-zA-Z]:[/\\\\]")
        if (!drivePath.containsMatchIn(input)) return input
        val head = input[0]
        return head.uppercaseChar() + input.substring(1)
    }

    fun isWindowsDrivePath(input: String): Boolean =
        Regex("^[a-zA-Z]:[/\\\\]").containsMatchIn(input)
}
