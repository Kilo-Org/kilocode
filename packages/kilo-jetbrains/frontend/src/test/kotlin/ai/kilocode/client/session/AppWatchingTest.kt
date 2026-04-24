package ai.kilocode.client.session

import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto

class AppWatchingTest : SessionControllerTestBase() {

    fun `test app state change fires AppChanged`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        flush()

        assertControllerEvents("AppChanged", events)
        assertSession(
            """
            [app: READY] [workspace: PENDING]
            """,
            m,
            show = false,
        )
    }
}
