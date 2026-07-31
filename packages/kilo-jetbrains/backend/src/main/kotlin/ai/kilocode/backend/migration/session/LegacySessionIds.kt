package ai.kilocode.backend.migration.session

import java.security.MessageDigest

/**
 * Deterministic SHA-1 IDs for legacy migration.
 *
 * Session, message, and project IDs must stay compatible with
 * packages/kilo-vscode/src/legacy-migration/sessions/lib/ids.ts so dedup works across clients.
 * Part IDs are JetBrains-ordered and intentionally differ from VS Code.
 */
object LegacySessionIds {

    fun createProjectId(worktree: String = ""): String = hash(worktree)

    fun createSessionId(id: String): String = prefixed("ses", id)

    fun createMessageId(id: String, index: Int): String = prefixed("msg", "$id:$index")

    fun createOrderedPartId(id: String, index: Int, ordinal: Int): String =
        "prt_migrated_${hash("$id:$index").take(20)}_${ordinal.toString().padStart(4, '0')}"

    private fun prefixed(prefix: String, value: String): String =
        "${prefix}_migrated_${hash(value).take(26)}"

    fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
        val bytes = digest.digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
