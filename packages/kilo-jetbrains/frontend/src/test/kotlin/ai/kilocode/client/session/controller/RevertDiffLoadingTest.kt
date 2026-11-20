package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.SessionRevertDto

/**
 * A session reverted in a previous run has no `session.diff` event to replay on open, and the
 * pinned CLI may not attach a diff to the revert marker. [SessionController.seedRevertDiff] fetches
 * the persisted session diff so the reverted-files banner has something to render.
 */
class RevertDiffLoadingTest : SessionControllerTestBase() {

    fun `test opening a reverted session seeds model diff from the diff rpc`() {
        rpc.session = session("ses_test").copy(revert = SessionRevertDto(messageID = "msg1", snapshot = "snap"))
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))
        rpc.history.add(MessageWithPartsDto(msg("msg2", "ses_test", "assistant"), emptyList()))
        rpc.diffs["ses_test"] = mutableListOf(DiffFileDto("src/A.kt", 2, 1, "@@ patch"))

        val c = controller("ses_test")
        flush()

        assertEquals("msg1", c.model.revert()?.messageID)
        assertEquals(listOf("src/A.kt"), c.model.diff.map { it.file })
    }

    fun `test opening a session without a revert does not fetch the diff`() {
        rpc.session = session("ses_test")
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))
        rpc.diffs["ses_test"] = mutableListOf(DiffFileDto("src/A.kt", 2, 1, "@@ patch"))

        val c = controller("ses_test")
        flush()

        assertNull(c.model.revert())
        assertTrue(c.model.diff.isEmpty())
    }
}
