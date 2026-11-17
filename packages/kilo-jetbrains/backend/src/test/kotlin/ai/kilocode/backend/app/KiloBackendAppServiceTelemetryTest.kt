package ai.kilocode.backend.app

import ai.kilocode.backend.rpc.KiloAppRpcApiImpl
import ai.kilocode.backend.telemetry.KiloBackendTelemetry
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Product telemetry follows `experimental.openTelemetry` in the global config. */
class KiloBackendAppServiceTelemetryTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    private fun create(): KiloBackendAppService {
        val telemetry = KiloBackendTelemetry(log)
        return KiloBackendAppService.create(scope, FakeCliServer(mock), log, telemetry = { telemetry })
    }

    private suspend fun ready(svc: KiloBackendAppService): KiloAppRpcApiImpl {
        svc.connect()
        withTimeout(TIMEOUT_MS) { svc.appState.first { it is KiloAppState.Ready } }
        return KiloAppRpcApiImpl(svc)
    }

    @Test
    fun `connect never overrides the telemetry state the CLI resolved`() = runBlocking {
        ready(create())

        // Both load events are sent after the point where the plugin used to force telemetry on.
        assertTrue(mock.awaitRequestCount(CAPTURE, 2), "load events were not captured; logs=${log.messages}")
        assertEquals(emptyList(), mock.telemetryStates.toList())
    }

    @Test
    fun `connect leaves a global config opt-out alone`() = runBlocking {
        mock.config = OPTED_OUT
        val svc = create()
        ready(svc)

        assertTrue(mock.awaitRequestCount(CAPTURE, 2))
        assertEquals(false, svc.config?.openTelemetry)
        assertEquals(emptyList(), mock.telemetryStates.toList())
    }

    @Test
    fun `turning telemetry off writes the global config and applies to the running CLI`() = runBlocking {
        val svc = create()
        val rpc = ready(svc)
        assertTrue(mock.awaitRequestCount(CAPTURE, 2))

        rpc.updateConfig(ConfigPatchDto(openTelemetry = false))

        assertEquals("""{"experimental":{"openTelemetry":false}}""", mock.lastConfigPatchBody)
        assertEquals(false, svc.config?.openTelemetry)
        assertEquals(listOf(OFF), mock.telemetryStates.toList())
    }

    @Test
    fun `turning telemetry back on applies to the running CLI`() = runBlocking {
        mock.config = OPTED_OUT
        val svc = create()
        val rpc = ready(svc)

        rpc.updateConfig(ConfigPatchDto(openTelemetry = true))

        assertEquals(true, svc.config?.openTelemetry)
        assertEquals(listOf(ON), mock.telemetryStates.toList())
    }

    @Test
    fun `unrelated config changes do not touch the telemetry state`() = runBlocking {
        val rpc = ready(create())

        rpc.updateConfig(ConfigPatchDto(snapshot = false))

        assertEquals(emptyList(), mock.telemetryStates.toList())
    }

    private companion object {
        const val TIMEOUT_MS = 35_000L
        const val CAPTURE = "/telemetry/capture"
        const val ON = """{"enabled":true}"""
        const val OFF = """{"enabled":false}"""
        const val OPTED_OUT = """{"model":"test/model","experimental":{"openTelemetry":false}}"""
    }
}
