package ai.kilocode.backend.telemetry

import ai.kilocode.backend.cli.await
import ai.kilocode.backend.dev.KiloDevMode
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

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
        post(http, port, "telemetry/capture", body)
    }

    suspend fun setEnabled(http: OkHttpClient?, port: Int, enabled: Boolean) {
        val body = JsonObject(mapOf("enabled" to JsonPrimitive(enabled))).toString()
        if (KiloDevMode.enabled()) {
            log.info(body)
            return
        }
        if (http == null || port <= 0) return
        post(http, port, "telemetry/setEnabled", body)
    }

    private suspend fun post(http: OkHttpClient, port: Int, path: String, body: String) {
        val req = Request.Builder()
            .url("http://127.0.0.1:$port/$path")
            .header("Accept", "application/json")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        // Bound the call at the coroutine layer, not via OkHttp call/read timeouts: a positive
        // socket/call timeout starts Okio's watchdog daemon, which pins the plugin classloader and
        // blocks dynamic unload (see KiloBackendHttpClients). Call.await runs on IO and is cancellable.
        try {
            withTimeout(TIMEOUT_MS) {
                http.newCall(req).await().use { res ->
                    if (!res.isSuccessful) log.warn("telemetry $path failed: HTTP ${res.code}")
                }
            }
        } catch (e: TimeoutCancellationException) {
            log.warn("telemetry $path timed out after ${TIMEOUT_MS}ms")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("telemetry $path failed: ${e.message}", e)
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
