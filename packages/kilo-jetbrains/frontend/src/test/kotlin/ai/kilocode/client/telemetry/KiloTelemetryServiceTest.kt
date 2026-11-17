package ai.kilocode.client.telemetry

import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred

class KiloTelemetryServiceTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var service: KiloTelemetryService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeAppRpcApi()
        service = KiloTelemetryService(coroutines.scope, rpc)
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test events are forwarded while usage analytics are on`() {
        service.send("Test Event", mapOf("source" to "test"))
        coroutines.drain()

        assertEquals(listOf(TelemetryCaptureDto("Test Event", mapOf("source" to "test"))), rpc.telemetry)
    }

    fun `test events are not forwarded while usage analytics are off`() {
        rpc.telemetryEnabled = false

        service.send("Test Event")
        coroutines.drain()

        assertEquals(emptyList<TelemetryCaptureDto>(), rpc.telemetry)
    }

    fun `test a setting change applies without a restart`() {
        service.send("First")
        coroutines.drain()

        service.update(false)
        service.send("Second")
        coroutines.drain()

        service.update(true)
        service.send("Third")
        coroutines.drain()

        assertEquals(listOf("First", "Third"), rpc.telemetry.map { it.event })
    }

    fun `test an unreadable setting drops the event and is read again`() {
        rpc.telemetryFails = true
        service.send("First")
        coroutines.drain()

        rpc.telemetryFails = false
        service.send("Second")
        coroutines.drain()

        assertEquals(listOf("Second"), rpc.telemetry.map { it.event })
    }

    fun `test an opt-out applied during the first read wins`() {
        val gate = CompletableDeferred<Unit>()
        rpc.telemetryGate = gate

        service.send("Test Event")
        service.update(false)
        gate.complete(Unit)
        coroutines.drain()

        assertEquals(emptyList<TelemetryCaptureDto>(), rpc.telemetry)
    }
}
