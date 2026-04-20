package ai.kilocode.client.session.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto

class TurnLifecycleTest : SessionModelTestBase() {

    fun `test TurnOpen fires BusyChanged true`() {
        val (_, events) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        flush()

        assertTrue(events.any { it is SessionEvent.BusyChanged && it.busy })
        assertTrue(events.any { it is SessionEvent.StatusChanged && it.text == KiloBundle.message("session.status.considering") })
    }

    fun `test TurnClose fires BusyChanged false and clears status`() {
        val (_, events) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        flush()
        emit(ChatEventDto.TurnClose("ses_test", "completed"))
        flush()

        val last = events.filterIsInstance<SessionEvent.BusyChanged>().last()
        assertFalse(last.busy)
        val status = events.filterIsInstance<SessionEvent.StatusChanged>().last()
        assertNull(status.text)
    }

    fun `test Error fires Error event with message`() {
        val (_, events) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "APIError", message = "Bad Request")))
        flush()

        val err = events.filterIsInstance<SessionEvent.Error>().firstOrNull()
        assertNotNull(err)
        assertEquals("Bad Request", err!!.message)
    }

    fun `test Error with null message falls back to type`() {
        val (_, events) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = null)))
        flush()

        val err = events.filterIsInstance<SessionEvent.Error>().first()
        assertEquals("timeout", err.message)
    }
}
