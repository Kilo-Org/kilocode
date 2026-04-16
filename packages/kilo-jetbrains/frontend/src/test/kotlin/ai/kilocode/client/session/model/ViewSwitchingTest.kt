package ai.kilocode.client.session.model

class ViewSwitchingTest : SessionModelTestBase() {

    fun `test first prompt shows messages view`() {
        val m = model()
        val events = collect(m)

        edt { m.prompt("hello") }
        flush()

        assertTrue(events.any { it is SessionEvent.ViewChanged && it.show })
    }

    fun `test ViewChanged not fired twice`() {
        val m = model()
        val events = collect(m)

        edt { m.prompt("first") }
        flush()
        edt { m.prompt("second") }
        flush()

        assertEquals(1, events.count { it is SessionEvent.ViewChanged && it.show })
    }
}
