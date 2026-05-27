package ai.kilocode.backend.migration.session

import java.security.MessageDigest

/**
 * Deterministic SHA-1 IDs matching VS Code migration formulas exactly.
 *
 * These must stay compatible with packages/kilo-vscode/src/legacy-migration/sessions/lib/ids.ts
 * so that sessions imported by VS Code have the same IDs as those imported by JetBrains.
 */
object LegacySessionIds {

    fun createProjectId(worktree: String = ""): String = hash(worktree)

    fun createSessionId(id: String): String = prefixed("ses", id)

    fun createMessageId(id: String, index: Int): String = prefixed("msg", "$id:$index")

    fun createPartId(id: String, index: Int, part: Int): String = prefixed("prt", "$id:$index:$part")

    fun createExtraPartId(id: String, index: Int, kind: String): String = prefixed("prt", "$id:$index:$kind")

    private fun prefixed(prefix: String, value: String): String =
        "${prefix}_migrated_${hash(value).take(26)}"

    fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
        val bytes = digest.digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
