package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto

class AppWatchingTest : SessionModelTestBase() {

    fun `test app state change fires AppChanged`() {
        val m = model()
        val events = collect(m)
        flush()

        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flush()

        assertTrue(events.any { it is SessionEvent.AppChanged })
        assertEquals(KiloAppStatusDto.READY, m.chat.app.status)
    }
}
