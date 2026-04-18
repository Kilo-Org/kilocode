package ai.kilocode.client.session.model

class SessionCreationTest : SessionModelTestBase() {

    fun `test prompt creates session on first call`() {
        val m = model()
        val events = collect(m)

        edt { m.prompt("hello") }
        flush()

        assertEquals(1, rpc.creates)
        assertEquals(1, rpc.prompts.size)
        assertEquals("ses_test", rpc.prompts[0].first)
        assertTrue(events.any { it is SessionEvent.ViewChanged && it.show })
    }

    fun `test prompt reuses existing session`() {
        val m = model()

        edt { m.prompt("first") }
        flush()
        edt { m.prompt("second") }
        flush()

        assertEquals(1, rpc.creates)
        assertEquals(2, rpc.prompts.size)
        assertEquals("ses_test", rpc.prompts[1].first)
    }

    fun `test prompt with existing ID skips creation`() {
        val m = model("existing")
        collect(m)
        flush()

        edt { m.prompt("hello") }
        flush()

        assertEquals(0, rpc.creates)
        assertEquals(1, rpc.prompts.size)
        assertEquals("existing", rpc.prompts[0].first)
    }
}
