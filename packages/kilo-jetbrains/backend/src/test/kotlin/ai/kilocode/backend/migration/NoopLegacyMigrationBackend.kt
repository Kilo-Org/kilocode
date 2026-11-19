package ai.kilocode.backend.migration

import ai.kilocode.backend.migration.session.LegacySessionParser
import kotlinx.serialization.json.*

internal class NoopLegacyMigrationBackend : LegacyMigrationBackend {
    val authCalls = mutableListOf<Pair<String, JsonObject>>()
    val configCalls = mutableListOf<JsonObject>()
    val transcripts = mutableListOf<LegacySessionParser.NormalizedSession>()
    var existingSessionIds: Set<String> = emptySet()
    var sessionImportSkipped = false
    var importError: RuntimeException? = null

    override suspend fun setAuth(provider: String, auth: JsonObject) {
        authCalls.add(provider to auth)
    }

    override suspend fun updateGlobalConfig(config: JsonObject) {
        configCalls.add(config)
    }

    override suspend fun sessionExists(id: String) = id in existingSessionIds

    override suspend fun importTranscript(
        parsed: LegacySessionParser.NormalizedSession
    ): LegacyImportResult {
        importError?.let { throw it }
        if (!sessionImportSkipped) transcripts.add(parsed)
        return LegacyImportResult(
            parsed.session.getValue("id").jsonPrimitive.content,
            sessionImportSkipped,
        )
    }
}
