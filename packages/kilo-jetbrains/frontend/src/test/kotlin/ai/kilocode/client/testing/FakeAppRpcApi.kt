package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart

/**
 * Fake [KiloAppRpcApi] for testing.
 *
 * Push state changes via [state]. Health check returns [health].
 *
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeAppRpcApi : KiloAppRpcApi {

    val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED))
    val collectors = AtomicInteger(0)
    var health = HealthDto(healthy = true, version = "1.0.0")

    var connected = false
        private set

    override suspend fun connect() {
        assertNotEdt("connect")
        connected = true
    }

    override suspend fun state(): Flow<KiloAppStateDto> {
        assertNotEdt("state")
        return state
            .onStart { collectors.incrementAndGet() }
            .onCompletion { collectors.decrementAndGet() }
    }

    override suspend fun health(): HealthDto {
        assertNotEdt("health")
        return health
    }

    override suspend fun restart() {
        assertNotEdt("restart")
    }

    override suspend fun reinstall() {
        assertNotEdt("reinstall")
    }
}
