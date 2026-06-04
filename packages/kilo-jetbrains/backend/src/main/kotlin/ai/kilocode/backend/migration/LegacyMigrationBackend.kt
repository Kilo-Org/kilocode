package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonObject

/**
 * Backend adapter for writing migrated data to the CLI (kilo serve).
 *
 * Implementations use raw OkHttp or the generated Kotlin client.
 * No threading or synchronization is assumed; callers own sequencing.
 */
interface LegacyMigrationBackend {
    /** PUT /auth/{providerID} */
    fun setAuth(provider: String, auth: JsonObject)

    /** PATCH /global/config */
    fun updateGlobalConfig(config: JsonObject)

    /** GET /session/{sessionID} — returns true if the session already exists */
    fun sessionExists(id: String): Boolean

    /** POST /kilocode/session-import/project — returns the project ID */
    fun importProject(project: JsonObject): String

    /** POST /kilocode/session-import/session */
    fun importSession(session: JsonObject): LegacyImportResult

    /** POST /kilocode/session-import/message */
    fun importMessage(message: JsonObject)

    /** POST /kilocode/session-import/part */
    fun importPart(part: JsonObject)
}

/**
 * No-op backend for testing detection without a live server.
 */
class NoopLegacyMigrationBackend : LegacyMigrationBackend {
    val authCalls = mutableListOf<Pair<String, JsonObject>>()
    val configCalls = mutableListOf<JsonObject>()
    val projectCalls = mutableListOf<JsonObject>()
    val sessionCalls = mutableListOf<JsonObject>()
    val messageCalls = mutableListOf<JsonObject>()
    val partCalls = mutableListOf<JsonObject>()

    var existingSessionIds: Set<String> = emptySet()
    var sessionImportSkipped = false
    var messageError: RuntimeException? = null
    var partError: RuntimeException? = null

    override fun setAuth(provider: String, auth: JsonObject) { authCalls.add(provider to auth) }
    override fun updateGlobalConfig(config: JsonObject) { configCalls.add(config) }
    override fun sessionExists(id: String) = id in existingSessionIds
    override fun importProject(project: JsonObject): String {
        projectCalls.add(project)
        return project["id"]?.toString()?.trim('"') ?: "prj_test"
    }
    override fun importSession(session: JsonObject): LegacyImportResult {
        sessionCalls.add(session)
        val id = session["id"]?.toString()?.trim('"') ?: "ses_test"
        return LegacyImportResult(id = id, skipped = sessionImportSkipped)
    }
    override fun importMessage(message: JsonObject) {
        messageError?.let { throw it }
        messageCalls.add(message)
    }
    override fun importPart(part: JsonObject) {
        partError?.let { throw it }
        partCalls.add(part)
    }
}
