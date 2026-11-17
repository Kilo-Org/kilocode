@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.telemetry

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.serviceOrNull
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

object Telemetry {
    fun send(event: String, properties: Map<String, String> = emptyMap()) {
        KiloTelemetryService.getInstance()?.send(event, properties)
    }
}

/** The loaded global config, without creating the app service just to send an event. */
private fun loaded(): ConfigDto? =
    ApplicationManager.getApplication()?.getServiceIfCreated(KiloAppService::class.java)?.state?.value?.config

@Service(Service.Level.APP)
class KiloTelemetryService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloAppRpcApi?,
    private val config: () -> ConfigDto?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    internal constructor(cs: CoroutineScope, rpc: KiloAppRpcApi?) : this(cs, rpc, ::loaded)

    companion object {
        private val LOG = KiloLog.create(KiloTelemetryService::class.java)
        private const val MAX_PENDING = 64
        private const val TIMEOUT_MS = 5_000L

        fun getInstance(): KiloTelemetryService? = serviceOrNull()
    }

    private val pending = AtomicInteger()
    private val warned = AtomicBoolean()

    /** The decision of the backend environment's `KILO_TELEMETRY_LEVEL`, once it has been read. */
    @Volatile
    private var override: Override? = null

    fun send(event: String, properties: Map<String, String> = emptyMap()) {
        if (pending.incrementAndGet() > MAX_PENDING) {
            pending.decrementAndGet()
            if (warned.compareAndSet(false, true)) {
                LOG.warn("telemetry backpressure: dropping events with more than $MAX_PENDING pending")
            }
            return
        }
        cs.launch {
            try {
                if (!allowed()) return@launch
                if (KiloLog.sandbox()) {
                    val payload = KiloLog.payload(LOG) + properties
                    LOG.info("event=$event ${payload.entries.joinToString(" ") { "${it.key}=${it.value}" }}")
                    return@launch
                }
                val dto = TelemetryCaptureDto(event, properties)
                val sent = withTimeoutOrNull(TIMEOUT_MS) {
                    val api = rpc
                    if (api != null) api.captureTelemetry(dto)
                    else durable { KiloAppRpcApi.getInstance().captureTelemetry(dto) }
                    true
                }
                if (sent != true) LOG.warn("telemetry capture timed out: $event")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LOG.warn("telemetry capture failed: ${e.message}", e)
            } finally {
                pending.decrementAndGet()
            }
        }
    }

    /**
     * Whether events may be forwarded, resolved like the CLI does: the backend environment's
     * `KILO_TELEMETRY_LEVEL` first, then `experimental.openTelemetry` from the global config. An
     * environment that cannot be read drops the event and is read again next time.
     */
    private suspend fun allowed(): Boolean {
        val known = override ?: withTimeoutOrNull(TIMEOUT_MS) {
            val api = rpc
            val value = if (api != null) api.telemetryOverride() else durable { KiloAppRpcApi.getInstance().telemetryOverride() }
            Override(value).also { override = it }
        } ?: return false
        return known.value ?: (config()?.openTelemetry != false)
    }

    private class Override(val value: Boolean?)
}
