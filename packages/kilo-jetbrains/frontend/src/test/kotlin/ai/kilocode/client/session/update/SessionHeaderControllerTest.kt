package ai.kilocode.client.session.update

import ai.kilocode.rpc.dto.ChatEventDto

class SessionHeaderControllerTest : SessionControllerTestBase() {

    fun `test session updated refreshes model metadata`() {
        val (m, _, modelEvents) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "Generated title")))

        assertEquals("Generated title", m.model.session?.title)
        assertEquals("Generated title", m.model.header.title)
        assertTrue(modelEvents.any { it is ai.kilocode.client.session.model.SessionModelEvent.SessionUpdated })
    }

    fun `test compact calls RPC with selected model when eligible`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        edt { m.compact() }
        flush()

        val call = rpc.compacts.single()
        assertEquals("ses_test", call.first)
        assertEquals("/test", call.second)
        assertEquals("kilo", call.third.providerID)
        assertEquals("gpt-5", call.third.modelID)
    }

    fun `test compact is blocked while busy`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.TurnOpen("ses_test"))

        edt { m.compact() }
        flush()

        assertTrue(rpc.compacts.isEmpty())
    }

    fun `test compact is blocked without model`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = null))
        projectRpc.state.value = workspaceReady(providers = emptyList(), connected = emptyList())
        val m = controller()
        flush()
        edt { m.prompt("go") }
        flush()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        edt { m.model.model = null }
        assertNull(m.model.model)

        edt { m.compact() }
        flush()

        assertTrue(rpc.compacts.isEmpty())
    }

    fun `test opened session metadata is seeded through constructor`() {
        rpc.history.add(ai.kilocode.rpc.dto.MessageWithPartsDto(msg("msg1", "ses_test", "assistant"), emptyList()))
        val c = controller(
            id = "ses_test",
            flushMs = Long.MAX_VALUE,
            condense = true,
            session = session("ses_test", title = "Opened title"),
        )

        flush()

        assertEquals("Opened title", c.model.session?.title)
        assertEquals("Opened title", c.model.header.title)
    }
}
