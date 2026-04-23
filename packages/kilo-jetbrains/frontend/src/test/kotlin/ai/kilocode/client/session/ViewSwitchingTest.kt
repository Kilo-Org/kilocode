package ai.kilocode.client.session

class ViewSwitchingTest : SessionControllerTestBase() {

    fun `test first prompt shows messages view`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.prompt("hello") }
        flush()

        assertControllerEvents("ViewChanged show", events)
        assertSession(
            """
            [app: DISCONNECTED] [workspace: PENDING]
            """,
            m,
        )
    }

    fun `test ViewChanged not fired twice`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.prompt("first") }
        flush()
        edt { m.prompt("second") }
        flush()

        assertControllerEvents("ViewChanged show", events)
    }
}
