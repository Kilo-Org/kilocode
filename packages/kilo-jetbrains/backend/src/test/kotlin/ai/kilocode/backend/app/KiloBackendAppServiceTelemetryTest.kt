package ai.kilocode.backend.app

import ai.kilocode.backend.rpc.KiloAppRpcApiImpl
import ai.kilocode.backend.telemetry.KiloBackendTelemetry
import ai.kilocode.backend.telemetry.KiloTelemetrySettings
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.TelemetryCaptureDto
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Telemetry state pushed to the CLI on connect and when the plugin setting changes. */
class KiloBackendAppServiceTelemetryTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        KiloTelemetrySettings.set(true)
        scope.cancel()
        mock.close()
    }

    private fun create(env: Map<String, String> = emptyMap()): KiloBackendAppService {
        val telemetry = KiloBackendTelemetry(log)
        return KiloBackendAppService.create(scope, FakeCliServer(mock), log, telemetry = { telemetry }, env = { env })
    }

    private suspend fun ready(svc: KiloBackendAppService) {
        svc.connect()
        withTimeout(TIMEOUT_MS) { svc.appState.first { it is KiloAppState.Ready } }
    }

    @Test
    fun `connect leaves the CLI telemetry state alone when the setting is on`() = runBlocking {
        val svc = create()

        ready(svc)

        // Both load events are sent after the point where an opt-out would have been pushed.
        assertTrue(mock.awaitRequestCount(CAPTURE, 2), "load events were not captured; logs=${log.messages}")
        assertEquals(emptyList(), mock.telemetryStates.toList())
    }

    @Test
    fun `connect turns CLI telemetry off when the setting is off`() = runBlocking {
        KiloTelemetrySettings.set(false)
        val svc = create()

        ready(svc)

        assertTrue(mock.awaitRequestCount(SET_ENABLED, 1), "opt-out was not pushed; logs=${log.messages}")
        assertEquals(listOf(OFF), mock.telemetryStates.toList())
        assertEquals(0, mock.requestCount(CAPTURE))
    }

    @Test
    fun `setting change is applied to the running CLI`() = runBlocking {
        val svc = create()
        ready(svc)
        val rpc = KiloAppRpcApiImpl(svc)

        rpc.setTelemetryEnabled(false)

        assertFalse(rpc.telemetryEnabled())
        assertEquals(listOf(OFF), mock.telemetryStates.toList())

        rpc.setTelemetryEnabled(true)

        assertTrue(rpc.telemetryEnabled())
        assertEquals(listOf(OFF, ON), mock.telemetryStates.toList())
    }

    @Test
    fun `unchanged setting is not pushed again`() = runBlocking {
        val svc = create()
        ready(svc)

        KiloAppRpcApiImpl(svc).setTelemetryEnabled(true)

        assertEquals(emptyList(), mock.telemetryStates.toList())
    }

    @Test
    fun `turning the setting on does not override an inherited opt-out`() = runBlocking {
        KiloTelemetrySettings.set(false)
        val svc = create(mapOf("KILO_TELEMETRY_LEVEL" to "off"))
        ready(svc)
        assertTrue(mock.awaitRequestCount(SET_ENABLED, 1))

        KiloAppRpcApiImpl(svc).setTelemetryEnabled(true)

        assertEquals(listOf(OFF), mock.telemetryStates.toList())
    }

    @Test
    fun `turning the setting on does not override a global config opt-out`() = runBlocking {
        KiloTelemetrySettings.set(false)
        mock.config = """{"model":"test/model","experimental":{"openTelemetry":false}}"""
        val svc = create()
        ready(svc)
        assertTrue(mock.awaitRequestCount(SET_ENABLED, 1))

        KiloAppRpcApiImpl(svc).setTelemetryEnabled(true)

        assertEquals(listOf(OFF), mock.telemetryStates.toList())
    }

    @Test
    fun `backend events are not forwarded while the setting is off`() = runBlocking {
        val svc = create()
        ready(svc)
        assertTrue(mock.awaitRequestCount(CAPTURE, 2))
        val rpc = KiloAppRpcApiImpl(svc)

        rpc.setTelemetryEnabled(false)
        val before = mock.requestCount(CAPTURE)
        rpc.captureTelemetry(TelemetryCaptureDto("Test Event", emptyMap()))

        assertEquals(before, mock.requestCount(CAPTURE))
    }

    private companion object {
        const val TIMEOUT_MS = 35_000L
        const val SET_ENABLED = "/telemetry/setEnabled"
        const val CAPTURE = "/telemetry/capture"
        const val ON = """{"enabled":true}"""
        const val OFF = """{"enabled":false}"""
    }
}
