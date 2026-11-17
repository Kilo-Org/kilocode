package ai.kilocode.client.telemetry

import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class KiloTelemetryServiceTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var service: KiloTelemetryService

    /** The loaded global config, null while the backend is not ready. */
    private var config: ConfigDto? = ConfigDto()

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeAppRpcApi()
        config = ConfigDto()
        service = KiloTelemetryService(coroutines.scope, rpc) { config }
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test events are forwarded by default`() {
        send("Test Event", mapOf("source" to "test"))

        assertEquals(listOf(TelemetryCaptureDto("Test Event", mapOf("source" to "test"))), rpc.telemetry)
    }

    fun `test events are not forwarded when the global config opts out`() {
        config = ConfigDto(openTelemetry = false)

        send("Test Event")

        assertEquals(emptyList<TelemetryCaptureDto>(), rpc.telemetry)
    }

    fun `test a config change applies without a restart`() {
        send("First")
        config = ConfigDto(openTelemetry = false)
        send("Second")
        config = ConfigDto(openTelemetry = true)
        send("Third")

        assertEquals(listOf("First", "Third"), rpc.telemetry.map { it.event })
    }

    fun `test an environment opt-out wins over the config`() {
        rpc.telemetryOverride = false
        config = ConfigDto(openTelemetry = true)

        send("Test Event")

        assertEquals(emptyList<TelemetryCaptureDto>(), rpc.telemetry)
    }

    fun `test an environment opt-in wins over the config, as in the CLI`() {
        rpc.telemetryOverride = true
        config = ConfigDto(openTelemetry = false)

        send("Test Event")

        assertEquals(listOf("Test Event"), rpc.telemetry.map { it.event })
    }

    fun `test events before the config is loaded are left to the CLI`() {
        config = null

        send("Test Event")

        assertEquals(listOf("Test Event"), rpc.telemetry.map { it.event })
    }

    fun `test an unreadable environment drops the event and is read again`() {
        rpc.telemetryFails = true
        send("First")

        rpc.telemetryFails = false
        send("Second")

        assertEquals(listOf("Second"), rpc.telemetry.map { it.event })
    }

    private fun send(event: String, props: Map<String, String> = emptyMap()) {
        service.send(event, props)
        coroutines.drain()
    }
}
