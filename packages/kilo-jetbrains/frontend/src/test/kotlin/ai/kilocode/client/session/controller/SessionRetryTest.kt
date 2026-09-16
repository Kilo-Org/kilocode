package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto

/**
 * Retry *continues* a failed turn: it re-prompts the original user message id with no parts and nothing
 * else. No revert, no message delete, so the transcript and the workspace are untouched and the CLI
 * simply starts a fresh assistant message under the same user turn.
 *
 * The revert this used to do widened server-side to the preceding user message, and the replay then
 * deleted that message and everything after it — the whole session when the failure hit the first turn.
 */
class SessionRetryTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        rpc.session = rpc.session.copy(id = "ses_test")
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
    }

    /** Two connected models so a test can switch selection after the failure. */
    private fun providers() = listOf(
        ProviderDto(
            id = "kilo",
            name = "Kilo",
            models = mapOf(
                "gpt-5" to ModelDto(
                    id = "gpt-5",
                    name = "GPT-5",
                    reasoning = true,
                    variants = listOf("low", "high"),
                ),
            ),
        ),
        ProviderDto(
            id = "anthropic",
            name = "Anthropic",
            models = mapOf("claude-opus-5" to ModelDto(id = "claude-opus-5", name = "Claude Opus 5")),
        ),
    )

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
        projectRpc.state.value = workspaceReady(providers = providers(), connected = listOf("kilo", "anthropic"))
    }

    /**
     * A turn that never reached the model has no assistant message at all: the CLI resolves the model
     * (and its credentials) before writing one, so the transcript tail is the user message.
     */
    private fun unanswered() {
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_user", "ses_test", "user").copy(providerID = "snowflake", modelID = "cortex", agent = "code"),
                emptyList(),
            ),
        )
        projectRpc.state.value = workspaceReady(
            providers = providers() + ProviderDto(
                id = "snowflake",
                name = "Snowflake",
                models = mapOf("cortex" to ModelDto(id = "cortex", name = "Cortex")),
            ),
            connected = listOf("kilo", "anthropic", "snowflake"),
        )
    }

    fun `test retry continues the failed turn without touching the transcript`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue("A revert widens to the user message server-side and deletes it", rpc.reverts.isEmpty())
        assertTrue("Nothing is deleted either — the failed turn is history", rpc.messageDeletes.isEmpty())

        assertEquals(1, rpc.prompts.size)
        val prompt = rpc.prompts.single().third
        assertEquals("ses_test", rpc.prompts.single().first)
        assertEquals("Continues the existing user message, no synthetic one", "msg_user", prompt.messageID)
        assertTrue("No parts means the CLI keeps the original prompt text", prompt.parts.isEmpty())
        assertEquals("kilo", prompt.providerID)
        assertEquals("gpt-5", prompt.modelID)
        assertEquals("code", prompt.agent)
    }

    /** The transcript is the thing the old revert-based retry destroyed, so assert it survives. */
    fun `test retry keeps the failed turn in the transcript`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        edt {
            assertEquals(
                "Both messages must still be there",
                listOf("msg_user", "msg_fail"),
                m.model.messages().map { it.info.id },
            )
        }
    }

    /** No "continue" text may reach the CLI: a visible user turn is exactly what this avoids. */
    fun `test retry sends no text part`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        val prompt = rpc.prompts.single().third
        assertTrue(prompt.parts.isEmpty())
        assertNull("A continue must not attach fresh editor context either", prompt.editorContext)
        edt {
            assertEquals(
                "No message was appended to the transcript",
                listOf("msg_user", "msg_fail"),
                m.model.messages().map { it.info.id },
            )
        }
    }

    fun `test retry uses the model selected after the failure`() {
        failed()
        val m = controller("ses_test")
        flush()

        // The usual reason a turn fails is the model it ran with, so switching model and hitting Retry
        // has to pick the new one up rather than replaying the one that just failed.
        edt { m.selectModel("anthropic", "claude-opus-5") }
        flush()
        edt { m.retry() }
        flush()

        val prompt = rpc.prompts.single().third
        assertEquals("anthropic", prompt.providerID)
        assertEquals("claude-opus-5", prompt.modelID)
        assertEquals("Still replays the original user message", "msg_user", prompt.messageID)
    }

    fun `test retry uses the effort selected after the failure`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.selectVariant("high") }
        flush()
        edt { m.retry() }
        flush()

        assertEquals("high", rpc.prompts.single().third.variant)
    }

    /**
     * Guards the distinction from login resume, which must keep the model recorded on the failed turn —
     * the user authenticated for that model. Only Retry follows the live selection.
     */
    fun `test retry follows the live selection even when it differs from the failed turn`() {
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_user", "ses_test", "user").copy(providerID = "kilo", modelID = "gpt-5", agent = "code"),
                emptyList(),
            ),
        )
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_fail", "ses_test", "assistant").copy(
                    parentID = "msg_user",
                    error = MessageErrorDto(type = "APIError", message = "missing credentials"),
                ),
                emptyList(),
            ),
        )
        projectRpc.state.value = workspaceReady(providers = providers(), connected = listOf("kilo", "anthropic"))
        val m = controller("ses_test")
        flush()

        edt { m.selectModel("anthropic", "claude-opus-5") }
        flush()
        edt { m.retry() }
        flush()

        val prompt = rpc.prompts.single().third
        assertEquals("anthropic", prompt.providerID)
        assertEquals("claude-opus-5", prompt.modelID)
    }

    /** The auto-routing model id contains a slash ("kilo-auto/free"), so only the provider may split off. */
    fun `test retry uses an auto routing model whose id contains a slash`() {
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_user", "ses_test", "user").copy(
                    providerID = "snowflake",
                    modelID = "cortex",
                    agent = "code",
                ),
                emptyList(),
            ),
        )
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_fail", "ses_test", "assistant").copy(
                    parentID = "msg_user",
                    error = MessageErrorDto(type = "UnknownError", message = "missing credentials"),
                ),
                emptyList(),
            ),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto Free")),
                ),
                ProviderDto(
                    id = "snowflake",
                    name = "Snowflake",
                    models = mapOf("cortex" to ModelDto(id = "cortex", name = "Cortex")),
                ),
            ),
            connected = listOf("kilo", "snowflake"),
        )
        val m = controller("ses_test")
        flush()

        edt { m.selectModel("kilo", "kilo-auto/free") }
        flush()
        edt { m.retry() }
        flush()

        val prompt = rpc.prompts.single().third
        assertEquals("kilo", prompt.providerID)
        assertEquals("kilo-auto/free", prompt.modelID)
    }

    /**
     * The error card is bound to the session state (`SessionMessageListPanel.syncActive`), so leaving the
     * failed state is what dismisses it. That has to happen on the click, not when the RPC returns.
     */
    fun `test retry leaves the failed state before the prompt resolves`() {
        failed()
        val m = controller("ses_test")
        flush()
        // seedOutcome() puts an errored tail into Error on load, which is what paints the card.
        edt { assertTrue("Precondition: the card is showing", m.model.state is SessionState.Error) }

        edt { m.retry() }

        edt { assertTrue("The card must be gone on click", m.model.state is SessionState.Busy) }
        flush()
        assertTrue(m.model.state is SessionState.Busy)
    }

    /** A busy state is also what makes a second click a no-op, so no double prompt can escape. */
    fun `test retry clicked twice prompts once`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        edt { m.retry() }
        flush()

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
        val m = controller("ses_test")
        flush()
        // A live turn is the deterministic way to be busy here: the recovery status map arrives through
        // a flow, so seeding rpc.statuses cannot be observed reliably right after the first flush.
        emit(ChatEventDto.TurnOpen("ses_test"))
        edt { assertTrue("Precondition: the session is busy", m.model.state is SessionState.Busy) }

        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertTrue("A busy session must not be continued", rpc.prompts.isEmpty())
    }

    fun `test retry is unavailable when nothing failed`() {
        rpc.history.add(MessageWithPartsDto(msg("msg_user", "ses_test", "user"), emptyList()))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        edt { assertFalse(m.canRetry()) }
        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertTrue(rpc.prompts.isEmpty())
    }

    /**
     * Missing provider credentials fail during model resolution, before the assistant message exists, so
     * the failure only surfaces as a session error over a user-message tail. Retry must still continue,
     * otherwise the card's only action is dead.
     */
    fun `test retry continues a turn that failed before the assistant message existed`() {
        unanswered()
        val m = controller("ses_test")
        flush()
        emit(
            ChatEventDto.Error(
                "ses_test",
                MessageErrorDto(type = "UnknownError", message = "Snowflake Cortex: missing credentials"),
            ),
        )

        edt { assertTrue(m.canRetry()) }
        edt { m.selectModel("anthropic", "claude-opus-5") }
        flush()
        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        val prompt = rpc.prompts.single().third
        assertEquals("Continues the existing user message, no synthetic one", "msg_user", prompt.messageID)
        assertTrue(prompt.parts.isEmpty())
        assertEquals("anthropic", prompt.providerID)
        assertEquals("claude-opus-5", prompt.modelID)
        assertTrue("Retry must hand off to the running turn", m.model.state is SessionState.Busy)
    }

    /** The same failure also arrives as a turn close with reason "error" when no session error follows. */
    fun `test retry continues an unanswered turn reported only by turn close`() {
        unanswered()
        val m = controller("ses_test")
        flush()
        emit(ChatEventDto.TurnClose("ses_test", "error"))

        // Switch off the model that could not authenticate, then raise its effort.
        edt { m.selectModel("kilo", "gpt-5") }
        flush()
        edt { m.selectVariant("high") }
        flush()
        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        val prompt = rpc.prompts.single().third
        assertEquals("msg_user", prompt.messageID)
        assertEquals("kilo", prompt.providerID)
        assertEquals("gpt-5", prompt.modelID)
        assertEquals("Effort switched after the failure has to reach the continue", "high", prompt.variant)
    }

    /**
     * A session-level error (a bad config, a plugin failure) can land after a turn that delivered its
     * answer. Continuing then would ask the model to redo delivered work, so the card must not offer it.
     */
    fun `test retry is unavailable when the last turn completed`() {
        rpc.history.add(MessageWithPartsDto(msg("msg_user", "ses_test", "user"), emptyList()))
        rpc.history.add(
            MessageWithPartsDto(
                msg("msg_ok", "ses_test", "assistant").copy(
                    parentID = "msg_user",
                    time = MessageTimeDto(created = 0.0, completed = 1.0),
                ),
                emptyList(),
            ),
        )
        projectRpc.state.value = workspaceReady(providers = providers(), connected = listOf("kilo", "anthropic"))
        val m = controller("ses_test")
        flush()
        emit(ChatEventDto.Error(null, MessageErrorDto(type = "UnknownError", message = "invalid kilo.json")))

        edt { assertFalse(m.canRetry()) }
        edt { m.retry() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertTrue("A completed turn must not be re-run", rpc.prompts.isEmpty())
    }

    fun `test retry is unavailable when the session has no user message`() {
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()
        emit(ChatEventDto.Error(null, MessageErrorDto(type = "UnknownError", message = "invalid kilo.json")))

        edt { assertFalse("Nothing to continue, so the card must not offer Retry", m.canRetry()) }
    }

    fun `test retry is offered for a failed assistant turn`() {
        failed()
        val m = controller("ses_test")
        flush()

        edt { assertTrue(m.canRetry()) }
    }

    fun `test retry is not offered after a user stop`() {
        failed(MessageErrorDto(type = MessageErrorDto.ABORTED, message = "aborted"))
        val m = controller("ses_test")
        flush()

        edt { assertFalse(m.canRetry()) }
    }

    fun `test retry surfaces an error when the prompt fails`() {
        failed()
        rpc.promptThrows = RuntimeException("backend unavailable")
        val m = controller("ses_test")
        flush()

        edt { m.retry() }
        flush()

        assertTrue(rpc.prompts.isEmpty())
        val state = m.model.state
        assertTrue("A rejected continue must not leave a fake busy state", state is SessionState.Error)
        assertEquals("backend unavailable", (state as SessionState.Error).message)
        edt { assertTrue("The card must offer Retry again", m.canRetry()) }
    }
}
