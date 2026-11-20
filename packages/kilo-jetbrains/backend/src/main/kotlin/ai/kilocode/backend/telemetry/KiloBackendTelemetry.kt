package ai.kilocode.backend.telemetry

import ai.kilocode.backend.dev.KiloDevMode
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

@Service(Service.Level.APP)
class KiloBackendTelemetry(
    private val log: KiloLog = KiloLog.create(KiloBackendTelemetry::class.java),
) {
    companion object {
        private const val TIMEOUT_MS = 5_000L
    }

    suspend fun capture(http: OkHttpClient?, port: Int, event: String, properties: Map<String, String>) {
        val body = payload(event, properties)
        if (KiloDevMode.enabled()) {
            log.info(body)
            return
        }
        if (http == null || port <= 0) return
        try {
            request(http, port, "telemetry/capture", body)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("telemetry capture failed: ${e.message}", e)
        }
    }

    /** A valid response also confirms that this CLI supports the settings endpoint. */
    suspend fun level(http: OkHttpClient, port: Int): Boolean? =
        request(http, port, "telemetry/level")?.let { Json.decodeFromString<Level>(it).enabled }

    /** Persist the preference and return the effective level after the CLI applies its opt-outs. */
    suspend fun setLevel(http: OkHttpClient, port: Int, enabled: Boolean): Boolean {
        val body = JsonObject(mapOf("enabled" to JsonPrimitive(enabled))).toString()
        val result = request(http, port, "telemetry/level", body) ?: error("CLI does not support telemetry settings")
        return Json.decodeFromString<Level>(result).enabled
    }

    @Serializable
    private data class Level(val enabled: Boolean)

    private suspend fun request(http: OkHttpClient, port: Int, path: String, body: String? = null): String? =
        withContext(Dispatchers.IO) {
            val client = http.newBuilder()
                .callTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .readTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build()
            val req = Request.Builder()
                .url("http://127.0.0.1:$port/$path")
                .header("Accept", "application/json")
                .apply { if (body != null) post(body.toRequestBody("application/json".toMediaType())) }
                .build()
            client.newCall(req).execute().use { res ->
                if (res.code == 404 && body == null) return@withContext null
                check(res.isSuccessful) { "telemetry $path failed: HTTP ${res.code}" }
                res.body.string()
            }
        }

    private fun payload(event: String, properties: Map<String, String>): String = JsonObject(
        mapOf(
            "event" to JsonPrimitive(event),
            "properties" to JsonObject(base() + properties.mapValues { JsonPrimitive(it.value) }),
        ),
    ).toString()

    private fun base(): Map<String, JsonPrimitive> =
        KiloLog.payload(log).mapValues { JsonPrimitive(it.value) }
}
