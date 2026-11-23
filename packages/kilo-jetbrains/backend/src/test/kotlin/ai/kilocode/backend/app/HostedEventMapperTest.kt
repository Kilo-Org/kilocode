package ai.kilocode.backend.app

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.dto.ChatEventDto
import kotlin.test.Test
import kotlin.test.assertEquals

class HostedEventMapperTest {
    @Test
    fun `terminal remaps native session without changing message or bounded lifecycle fields`() {
        val event = ChatEventDto.MessageTerminal("ses_native", "msg_prompt", "failed", "queued", false)
        val composite = "hosted:kilo-cloud:workspace:ses_native"
        val mapped = HostedEventMapper.event(event, composite, "/cloud")
        assertEquals(event.copy(sessionID = composite), mapped)
        assertEquals(composite, ChatLogSummary.sid(mapped))
        assertEquals(
            "sid=$composite evt=cloud.message.terminal mid=msg_prompt status=failed delivery=queued accepted=false",
            ChatLogSummary.event(mapped),
        )
    }
}
