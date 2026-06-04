package ai.kilocode.backend.migration

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.cli.KiloCliConfigPath
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/** Provides the production [LegacyMigrationStore] backed by the CLI Kilo config directory. */
@Service(Service.Level.APP)
class KiloBackendLegacyMigrationStoreService {

    companion object {
        fun getInstance(): KiloBackendLegacyMigrationStoreService = service()

        internal fun store(log: KiloLog): LegacyMigrationStore {
            val env = KiloBackendCliManager(log).buildEnv("migration")
            val file = KiloCliConfigPath.legacySettingsFile(env)
            log.info("Migration store: file=${file.absolutePath}")
            return LegacySettingsFileMigrationStore(file) { msg, err ->
                if (err == null) log.warn(msg) else log.warn(msg, err)
            }
        }
    }

    private val log = KiloLog.create(KiloBackendLegacyMigrationStoreService::class.java)

    fun store(): LegacyMigrationStore = store(log)
}

class LegacySettingsFileMigrationStore(
    private val file: File,
    private val warn: (String, Throwable?) -> Unit = { _, _ -> },
) : LegacyMigrationStore {
    companion object {
        private val json = Json { prettyPrint = true }
        private const val STATUS = "migrationStatus"
    }

    override fun status(): LegacyMigrationStatus? {
        val raw = read()?.get(STATUS)?.jsonPrimitive?.content ?: return null
        return runCatching { LegacyMigrationStatus.valueOf(raw) }.getOrNull()
    }

    override fun mark(status: LegacyMigrationStatus) {
        val root = read().orEmpty().toMutableMap()
        root[STATUS] = JsonPrimitive(status.name)
        write(JsonObject(root))
    }

    override fun providerProfilesRaw(): String? = string("providerProfiles")
    override fun oauthRaw(key: String): String? = (read()?.get("oauth") as? JsonObject)?.get(key)?.jsonPrimitive?.content
    override fun mcpSettingsRaw(): String? = string("mcpSettings")
    override fun customModesRaw(): String? = string("customModes")
    override fun customModePromptsRaw(): String? = string("customModePrompts")
    override fun autocompleteRaw(): String? = string("autocomplete")
    override fun globalStateValue(key: String): JsonElement? = (read()?.get("globalState") as? JsonObject)?.get(key)
    override fun taskHistoryRaw(): String? = string("taskHistory")
    override fun taskConversationRaw(id: String): String? = (read()?.get("conversations") as? JsonObject)?.get(id)?.jsonPrimitive?.content

    override fun cleanup(targets: LegacyCleanupTargets): LegacyCleanupReport {
        val root = read()?.toMutableMap() ?: return LegacyCleanupReport(cleaned = emptyList(), errors = emptyList())
        if (targets.legacySettingsFile) {
            val err = runCatching {
                if (file.delete()) null else "Failed to delete ${file.absolutePath}"
            }.getOrElse { it.message ?: "Failed to delete ${file.absolutePath}" }
            return LegacyCleanupReport(
                cleaned = if (err == null) listOf("legacySettingsFile") else emptyList(),
                errors = listOfNotNull(err),
            )
        }
        val cleaned = mutableListOf<String>()
        if (targets.providerProfiles && root.remove("providerProfiles") != null) cleaned.add("providerProfiles")
        if (targets.mcpSettings && root.remove("mcpSettings") != null) cleaned.add("mcpSettings")
        if (targets.customModes && root.remove("customModes") != null) cleaned.add("customModes")
        if (targets.globalState && root.remove("globalState") != null) cleaned.add("globalState")
        if (targets.taskHistory) {
            val history = root.remove("taskHistory") != null
            val conv = root.remove("conversations") != null
            if (history || conv) cleaned.add("taskHistory")
        }
        val err = runCatching { write(JsonObject(root)) }.exceptionOrNull()?.message
        return LegacyCleanupReport(cleaned = if (err == null) cleaned else emptyList(), errors = listOfNotNull(err))
    }

    private fun string(key: String): String? = read()?.get(key)?.jsonPrimitive?.content

    private fun read(): JsonObject? {
        if (!file.isFile) return null
        return try {
            json.parseToJsonElement(file.readText()).jsonObject
        } catch (e: SerializationException) {
            warn("Malformed legacy migration settings at ${file.absolutePath}", e)
            null
        } catch (e: IllegalArgumentException) {
            warn("Malformed legacy migration settings at ${file.absolutePath}", e)
            null
        }
    }

    private fun write(root: JsonObject) {
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(JsonObject.serializer(), root))
    }
}
