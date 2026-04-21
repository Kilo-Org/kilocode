package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.MessageWithPartsDto

class HistoryLoadingTest : SessionModelTestBase() {

    fun `test existing session loads history on init`() {
        val m = msg("msg1", "ses_test", "user")
        val p = part("prt1", "ses_test", "msg1", "text", text = "hello")
        rpc.history.add(MessageWithPartsDto(m, listOf(p)))

        val model = model("ses_test")
        val events = collect(model)
        flush()

        assertTrue(events.any { it is SessionEvent.HistoryLoaded })
        assertNotNull(model.chat.message("msg1"))
        assertEquals("hello", model.chat.part("msg1", "prt1")?.text?.toString())
    }

    fun `test non-empty history shows messages view`() {
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))

        val model = model("ses_test")
        val events = collect(model)
        flush()

        assertTrue(events.any { it is SessionEvent.ViewChanged && it.show })
        assertTrue(model.chat.showMessages)
    }
}
