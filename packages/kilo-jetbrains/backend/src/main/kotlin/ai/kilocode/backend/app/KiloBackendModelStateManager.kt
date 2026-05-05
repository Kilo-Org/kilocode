package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

class KiloBackendModelStateManager(
    private val log: KiloLog,
) {
    companion object {
        private val DEFAULT_DIR = Path.of(System.getProperty("user.home"), ".local", "state", "kilo")
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()

    private var client: OkHttpClient? = null
    private var base: String? = null
    private var file: Path? = null

    fun start(http: OkHttpClient, port: Int) {
        client = http
        base = "http://127.0.0.1:$port"
        file = null
    }

    fun stop() {
        client = null
        base = null
        file = null
    }

    suspend fun state(): ModelStateDto = mutex.withLock {
        KiloCliDataParser.parseModelState(read().orEmpty())
    }

    suspend fun favorite(update: ModelFavoriteUpdateDto): ModelStateDto = mutex.withLock {
        val raw = read()
        val key = update.providerID to update.modelID
        val state = KiloCliDataParser.parseModelState(raw.orEmpty())
        val current = state.favorite
        val exists = current.any { it.providerID to it.modelID == key }
        val next = when (update.action) {
            "add" -> if (exists) current else listOf(ModelSelectionDto(update.providerID, update.modelID)) + current
            "remove" -> current.filterNot { it.providerID to it.modelID == key }
            else -> current
        }
        val updated = state.copy(favorite = next)
        write(KiloCliDataParser.buildModelStateJson(raw, updated))
        updated
    }

    suspend fun selection(update: ModelSelectionUpdateDto): ModelStateDto = mutex.withLock {
        val raw = read()
        val state = KiloCliDataParser.parseModelState(raw.orEmpty())
        val next = state.model + (update.agent to ModelSelectionDto(update.providerID, update.modelID))
        val updated = state.copy(model = next)
        write(KiloCliDataParser.buildModelStateJson(raw, updated))
        updated
    }

    suspend fun clear(agent: String): ModelStateDto = mutex.withLock {
        val raw = read()
        val state = KiloCliDataParser.parseModelState(raw.orEmpty())
        val updated = state.copy(model = state.model - agent)
        write(KiloCliDataParser.buildModelStateJson(raw, updated))
        updated
    }

    suspend fun variant(update: ModelVariantUpdateDto): ModelStateDto = mutex.withLock {
        val raw = read()
        val state = KiloCliDataParser.parseModelState(raw.orEmpty())
        val updated = state.copy(variant = state.variant + (update.key to update.value))
        write(KiloCliDataParser.buildModelStateJson(raw, updated))
        updated
    }

    private fun read(): String? {
        val path = resolve() ?: return null
        if (!path.exists()) return null
        return try {
            path.readText()
        } catch (e: Exception) {
            log.warn("model state read failed: ${e.message}")
            null
        }
    }

    private fun write(raw: String) {
        val path = resolve() ?: return
        path.parent?.createDirectories()
        path.writeText(raw)
    }

    private fun resolve(): Path? {
        file?.let { return it }
        val http = client ?: return null
        val url = base ?: return null
        val request = Request.Builder().url("$url/path").get().build()
        return try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    log.warn("path fetch failed: HTTP ${response.code}")
                    return null
                }
                val raw = response.body?.string() ?: return null
                val state = json.parseToJsonElement(raw).jsonObject["state"]?.jsonPrimitive?.contentOrNull
                val dir = state?.let(Path::of) ?: DEFAULT_DIR
                Files.createDirectories(dir)
                dir.resolve("model.json").also { file = it }
            }
        } catch (e: Exception) {
            log.warn("path fetch failed: ${e.message}")
            Files.createDirectories(DEFAULT_DIR)
            DEFAULT_DIR.resolve("model.json").also { file = it }
        }
    }

}
