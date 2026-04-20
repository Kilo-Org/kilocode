package ai.kilocode.client.session.model

class ConfigSelectionTest : SessionModelTestBase() {

    fun `test selectModel updates ChatModel and calls updateConfig`() {
        val m = model()
        collect(m)
        flush()

        edt { m.selectModel("kilo", "gpt-5") }
        flush()

        assertEquals("kilo/gpt-5", m.chat.model)
        assertEquals(1, rpc.configs.size)
        assertEquals("kilo/gpt-5", rpc.configs[0].second.model)
    }

    fun `test selectAgent updates ChatModel and calls updateConfig`() {
        val m = model()
        collect(m)
        flush()

        edt { m.selectAgent("plan") }
        flush()

        assertEquals("plan", m.chat.agent)
        assertEquals(1, rpc.configs.size)
        assertEquals("plan", rpc.configs[0].second.agent)
    }

    fun `test selectModel fires WorkspaceReady event`() {
        val m = model()
        val events = collect(m)
        flush()

        edt { m.selectModel("kilo", "gpt-5") }
        flush()

        assertTrue(events.any { it is SessionEvent.WorkspaceReady })
    }
}
