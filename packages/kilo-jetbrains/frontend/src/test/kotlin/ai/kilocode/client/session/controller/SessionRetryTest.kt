package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.coroutines.CompletableDeferred

/**
 * Retry replays the last user turn after a failure: revert to the failed assistant message (which
 * restores files when that turn edited any), then re-prompt reusing the original user message id so no
 * synthetic message is appended. The failed message itself is removed server-side by
 * `SessionRevert.cleanup` on the prompt that follows.
 */
class SessionRetryTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        rpc.session = rpc.session.copy(id = "ses_test")
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
    }

    private fun failed(error: MessageErrorDto? = MessageErrorDto(type = "APIError", message = "provider overloaded")) {
        // The model/agent a turn ran with live on the user message, which is what the replay reuses.
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_user", "ses_test", "user").copy(providerID = "kilo", modelID = "gpt-5", agent = "code"),
                emptyList(),
            ),
        )
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_fail", "ses_test", "assistant").copy(parentID = "msg_user", error = error),
                emptyList(),
            ),
        )
        projectRpc.state.value = workspaceReady()
    }

    fun `test retry reverts the failed turn then replays the user message`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertEquals(1, rpc.reverts.size)
        val revert = rpc.reverts.single()
        assertEquals("ses_test", revert.id)
        assertEquals("msg_fail", revert.message)
        assertNull("Reverting the whole message, not truncating its parts", revert.part)

        assertEquals(1, rpc.prompts.size)
        val prompt = rpc.prompts.single().third
        assertEquals("Replays the existing user message, no synthetic one", "msg_user", prompt.messageID)
        assertTrue("An empty part list leaves the original user parts intact", prompt.parts.isEmpty())
        assertEquals("kilo", prompt.providerID)
        assertEquals("gpt-5", prompt.modelID)
        assertEquals("code", prompt.agent)
    }

    fun `test retry does not prompt until the revert completes`() {
        failed()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue("The prompt must not race the workspace restore", rpc.prompts.isEmpty())
        assertTrue(m.model.state is SessionState.Reverting)

        gate.complete(Unit)
        flush()

        assertEquals(1, rpc.reverts.size)
        assertEquals(1, rpc.prompts.size)
    }

    fun `test retry lands on busy not idle`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue("Retry must hand off to the running turn", m.model.state is SessionState.Busy)
    }

    fun `test retry is unavailable after a user stop`() {
        failed(MessageErrorDto(type = MessageErrorDto.ABORTED, message = "aborted"))
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue("A stop is not a failure", rpc.reverts.isEmpty())
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test retry is unavailable while the session is busy`() {
        failed()
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test retry is unavailable when the tail is not an assistant turn`() {
        rpc.history.add(MessageWithPartsDto(msg("msg_user", "ses_test", "user"), emptyList()))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test retry surfaces an error when the revert fails`() {
        failed()
        rpc.revertThrows = RuntimeException("snapshot unavailable")
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue(rpc.prompts.isEmpty())
        val state = m.model.state
        assertTrue("A failed revert must stay visible", state is SessionState.Error)
        assertEquals("snapshot unavailable", (state as SessionState.Error).message)
    }
}
