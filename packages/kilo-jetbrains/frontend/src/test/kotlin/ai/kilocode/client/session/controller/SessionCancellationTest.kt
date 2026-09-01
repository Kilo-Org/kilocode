package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageWithPartsDto

/**
 * A cancellation nobody asked for has to explain itself.
 *
 * The CLI reports a Stop and a server-side cancellation with the same `MessageAbortedError`, and the UI
 * used to treat both as a Stop: a muted "Stopped" line, no reason, no Retry, no telemetry. Three
 * sessions once died to a config reload leaving no trace anywhere the user could see. Only this client
 * knows whether it pressed Stop, so that is what separates the two here.
 */
class SessionCancellationTest : SessionControllerTestBase() {

    private val abort = MessageErrorDto(type = MessageErrorDto.ABORTED, message = "Aborted")

    private fun reloadText() = KiloBundle.message("session.cancelled.reload")

    private fun unknownText() = KiloBundle.message("session.cancelled.unknown")

    private fun cancelled(text: String) = SessionState.Error(text, MessageErrorDto.ABORTED)

    fun `test unrequested abort surfaces an error instead of Stopped`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", abort))
        emit(ChatEventDto.TurnClose("ses_test", "interrupted"))

        assertEquals(cancelled(unknownText()), m.model.state)
    }

    fun `test interruption names the reason on the error`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.SessionInterrupted("ses_test", ChatEventDto.SessionInterrupted.RELOAD))
        emit(ChatEventDto.Error("ses_test", abort))
        emit(ChatEventDto.TurnClose("ses_test", "interrupted"))

        assertEquals(cancelled(reloadText()), m.model.state)
    }

    /**
     * The CLI publishes the cancellation while it is still disposing, so the event naming the cause can
     * land on either side of the abort. Both orders have to end up on the same message.
     */
    fun `test interruption arriving after the abort relabels the error`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", abort))
        assertEquals(cancelled(unknownText()), m.model.state)

        emit(ChatEventDto.SessionInterrupted("ses_test", ChatEventDto.SessionInterrupted.RELOAD))

        assertEquals(cancelled(reloadText()), m.model.state)
    }

    /** The transcript cannot reach a worktree the user is not looking at; the balloon can. */
    fun `test unrequested abort raises a balloon naming the reason`() {
        prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.SessionInterrupted("ses_test", ChatEventDto.SessionInterrupted.RELOAD))
        emit(ChatEventDto.Error("ses_test", abort))

        assertEquals(listOf(KiloBundle.message("session.cancelled.title") to reloadText()), notifications)
    }

    fun `test unrequested abort is reported to telemetry`() {
        prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", abort))

        assertTrue(
            appRpc.telemetry.any {
                it.event == "Session Error" && it.properties["errorClass"] == MessageErrorDto.ABORTED
            },
        )
    }

    fun `test unrequested abort offers Retry`() {
        val m = failedTurn()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", abort))
        emit(ChatEventDto.TurnClose("ses_test", "interrupted"))

        assertEquals(cancelled(unknownText()), m.model.state)
        edt { assertTrue("A turn the user never stopped lost work, so it must be continuable", m.canRetry()) }
    }

    fun `test stopped turn offers no Retry`() {
        val m = failedTurn()

        emit(ChatEventDto.TurnOpen("ses_test"))
        edt { m.abort() }
        flush()
        emit(ChatEventDto.Error("ses_test", abort))
        emit(ChatEventDto.TurnClose("ses_test", "interrupted"))

        assertTrue(notifications.isEmpty())
        edt { assertFalse(m.canRetry()) }
    }

    /** A revert aborts a busy session on purpose, so its abort is a Stop and not a lost turn. */
    fun `test revert abort counts as requested`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        edt { m.revert("msg1") }
        flush()
        emit(ChatEventDto.Error("ses_test", abort))

        assertTrue(notifications.isEmpty())
        assertFalse(m.model.state is SessionState.Error)
    }

    /** The flag describes one cancellation. A later turn must not inherit the earlier Stop. */
    fun `test a new turn stops inheriting the previous Stop`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        edt { m.abort() }
        flush()
        emit(ChatEventDto.Error("ses_test", abort))
        emit(ChatEventDto.TurnClose("ses_test", "interrupted"))
        assertTrue(notifications.isEmpty())

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", abort))

        assertEquals(cancelled(unknownText()), m.model.state)
    }

    /** A reopened session cannot know who stopped its last turn, so history stays a plain "Stopped". */
    fun `test reopened session keeps an aborted tail as Stopped`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        rpc.history.add(MessageWithPartsDto(msg("msg_user", "ses_test", "user"), emptyList()))
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_fail", "ses_test", "assistant").copy(parentID = "msg_user", error = abort),
                emptyList(),
            ),
        )
        val m = controller("ses_test")
        collect(m)
        flush()

        assertTrue(m.model.state is SessionState.TurnEnded)
        assertTrue(notifications.isEmpty())
    }

    /**
     * A loaded session whose tail can be continued: Retry needs a user message to re-prompt and an
     * assistant message parented to it.
     */
    private fun failedTurn(): SessionController {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_user", "ses_test", "user").copy(providerID = "kilo", modelID = "gpt-5", agent = "code"),
                emptyList(),
            ),
        )
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_fail", "ses_test", "assistant").copy(parentID = "msg_user", error = abort),
                emptyList(),
            ),
        )
        val m = controller("ses_test")
        collect(m)
        flush()
        return m
    }
}
