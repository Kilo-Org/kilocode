package ai.kilocode.backend.migration

import ai.kilocode.backend.migration.session.LegacySessionParser
import kotlinx.serialization.json.JsonObject

interface LegacyMigrationBackend {
    suspend fun setAuth(provider: String, auth: JsonObject)

    suspend fun updateGlobalConfig(config: JsonObject)

    suspend fun sessionExists(id: String): Boolean

    suspend fun importTranscript(parsed: LegacySessionParser.NormalizedSession): LegacyImportResult
}
