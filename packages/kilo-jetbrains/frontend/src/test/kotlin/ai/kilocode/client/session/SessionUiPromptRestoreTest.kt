package ai.kilocode.client.session

import ai.kilocode.client.session.controller.PromptSelection
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.testing.TEST_WAIT_MS
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.SessionRevertDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking

/**
 * Regression coverage for the data-loss bug where a prompt that failed before any message was
 * persisted (an attachment rejected synchronously, or a prompt_async send that returns 204 and
 * then fails asynchronously) permanently lost the user's typed text: the editor was cleared on
 * submit and there was no draft store or prompt history to recover it from. See
 * SessionUi.sendPrompt/onStateChanged and PromptPanel.restoreLastSubmission.
 */
@Suppress("UnstableApiUsage")
class SessionUiPromptRestoreTest : SessionUiTestBase() {

    fun `test initial history failure restores an automatic handoff as an explicit draft`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        rpc.historyThrows = IllegalStateException("history unavailable")
        reopen()
        val failed = signal { it is SessionModelEvent.StateChanged && it.state is SessionState.Error }
        val events = mutableListOf<SessionModelEvent>()
        controller().model.addListener(ui) { events += it }
        val started = handoff()

        gate.complete(Unit)
        await(failed)

        val panel = find<PromptPanel>(ui)
        assertFalse(events.any { it is SessionModelEvent.HistoryLoaded })
        assertEquals("initial prompt", panel.text())
        assertTrue(panel.isSendEnabled)
        assertFalse(started.isCompleted)
        assertTrue(rpc.prompts.isEmpty())

        panel.send()
        assertEquals("initial prompt", await(started))
        assertHandoff("initial prompt")
        assertEquals("", panel.text())

        // A later failure can still be uncertain. Dismissal must not replay this explicit send.
        controller().model.setState(SessionState.Error("send outcome unknown"))
        controller().dismissError()
        settle()
        assertEquals("initial prompt", panel.text())
        assertEquals(1, rpc.prompts.size)
    }

    fun `test handoff attached in Error remains explicit after dismissal without a message event`() {
        rpc.historyThrows = IllegalStateException("history unavailable")
        reopen()
        val failed = signal { it is SessionModelEvent.StateChanged && it.state is SessionState.Error }
        await(failed)
        val events = mutableListOf<SessionModelEvent>()
        controller().model.addListener(ui) { events += it }
        val started = handoff()
        val panel = find<PromptPanel>(ui)
        panel.setText("a newer composer draft")

        controller().dismissError()
        settle()

        assertSame(SessionState.Idle, controller().model.state)
        assertTrue(events.all { it is SessionModelEvent.StateChanged || it is SessionModelEvent.HeaderUpdated })
        assertTrue(rpc.prompts.isEmpty())
        assertFalse(started.isCompleted)
        assertEquals("a newer composer draft", panel.text())

        ui.submitPrompt("initial prompt", clearDraft = false)
        assertEquals("initial prompt", await(started))
        assertHandoff("initial prompt")
        assertEquals("a newer composer draft", panel.text())
    }

    fun `test failed handoff preserves composer edits and can send after workspace readiness`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(status = KiloWorkspaceStatusDto.PENDING)
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        rpc.historyThrows = IllegalStateException("history unavailable")
        reopen()
        val failed = signal { it is SessionModelEvent.StateChanged && it.state is SessionState.Error }
        var confirmed = false
        val started = handoff { confirmed = true }
        val panel = find<PromptPanel>(ui)
        panel.setText("an edited prompt")

        gate.complete(Unit)
        await(failed)
        assertEquals("an edited prompt", panel.text())
        assertFalse(panel.isSendEnabled)
        controller().dismissError()
        workspaceRpc.state.value = workspaceRpc.state.value.copy(status = KiloWorkspaceStatusDto.READY)
        settle()

        assertTrue(panel.isSendEnabled)
        assertTrue(rpc.prompts.isEmpty())
        assertFalse(started.isCompleted)
        assertEquals("an edited prompt", panel.text())
        panel.send()
        assertEquals("an edited prompt", await(started))
        assertHandoff("an edited prompt")

        panel.setText("the next draft")
        controller().model.upsertMessage(message("unrelated"))
        assertFalse(confirmed)
        assertEquals("the next draft", panel.text())
        controller().model.upsertMessage(message("msg_handoff"))
        assertTrue(confirmed)
        assertEquals("the next draft", panel.text())
    }

    fun `test history becoming ready after Error does not automatically replay a handoff`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        reopen()
        val loaded = signal { it is SessionModelEvent.HistoryLoaded }
        val started = handoff()

        controller().model.setState(SessionState.Error("temporarily unavailable"))
        controller().dismissError()
        gate.complete(Unit)
        await(loaded)
        settle()

        val panel = find<PromptPanel>(ui)
        assertSame(SessionState.Idle, controller().model.state)
        assertEquals("initial prompt", panel.text())
        assertFalse(started.isCompleted)
        assertTrue(rpc.prompts.isEmpty())
        panel.send()
        assertEquals("initial prompt", await(started))
        assertHandoff("initial prompt")
    }

    fun `test explicit picker edits while history loads replace recovered handoff choices`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        reopen()
        val loaded = signal { it is SessionModelEvent.HistoryLoaded }
        val started = handoff(automatic = false)
        val panel = find<PromptPanel>(ui)
        settle()
        panel.mode.cycle()
        panel.model.onSelect(ModelPicker.Item("gpt-6", "GPT-6", "kilo", "Kilo"))
        panel.reasoning.onSelect(ReasoningPicker.Item("low", "Low"))
        panel.setText("edited recovered prompt")
        assertEquals("code", controller().model.agent)
        assertEquals("kilo/gpt-6", controller().model.model)
        assertEquals("low", controller().model.variant)

        gate.complete(Unit)
        await(loaded)

        assertEquals("code", controller().model.agent)
        assertEquals("kilo/gpt-6", controller().model.model)
        assertEquals("low", controller().model.variant)
        assertEquals("edited recovered prompt", panel.text())
        assertTrue(rpc.prompts.isEmpty())
        assertFalse(started.isCompleted)
        panel.send()
        assertEquals("edited recovered prompt", await(started))
        assertHandoff("edited recovered prompt", PromptSelection("code", "kilo", "gpt-6", "low"))
    }

    fun `test automatic handoff uses picker edits made before history finishes`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        reopen()
        val started = handoff()
        val panel = find<PromptPanel>(ui)
        settle()
        panel.mode.cycle()
        panel.model.onSelect(ModelPicker.Item("gpt-6", "GPT-6", "kilo", "Kilo"))
        panel.reasoning.onSelect(ReasoningPicker.Item("low", "Low"))
        panel.setText("a separate next draft")
        assertTrue(rpc.prompts.isEmpty())

        gate.complete(Unit)
        assertEquals("initial prompt", await(started))

        assertHandoff("initial prompt", PromptSelection("code", "kilo", "gpt-6", "low"))
        assertEquals("code", controller().model.agent)
        assertEquals("kilo/gpt-6", controller().model.model)
        assertEquals("low", controller().model.variant)
        assertEquals("a separate next draft", panel.text())
    }

    fun `test failed send restores the typed prompt into the editor`() {
        showMessages()
        rpc.prompts.clear()
        rpc.promptThrows = RuntimeException("ImageDecodeError: Image could not be decoded")

        val editor = find<EditorTextField>(ui)
        editor.text = "don't lose this message"

        find<PromptPanel>(ui).send()
        // Wait for the dispatch failure to actually land rather than for a fixed budget: the send
        // crosses coroutine -> invokeLater -> EDT, which can outlast a short delay under load.
        assertTrue(
            "the send failure never reached the model",
            pumpUntil { controller().model.state is SessionState.Error },
        )

        assertTrue("A rejected send must not reach the backend as a persisted prompt", rpc.prompts.isEmpty())
        assertEquals("don't lose this message", find<PromptPanel>(ui).text())
    }

    fun `test successful send does not leave a stale restorable draft`() {
        showMessages()
        rpc.prompts.clear()

        val editor = find<EditorTextField>(ui)
        editor.text = "this one goes through"

        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        assertEquals(1, rpc.prompts.size)
        assertEquals("", find<PromptPanel>(ui).text())

        // Simulate the server actually persisting the user's message (what a real backend does
        // right after accepting the prompt), then a later, unrelated turn failure. That failure
        // must not resurrect text that already made it into the transcript.
        emit(ChatEventDto.MessageUpdated("ses_test", message("restore_test_user_msg")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("restore_test_part", "restore_test_user_msg", "text", "this one goes through")))
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "boom")))
        assertTrue(
            "the error never reached the model",
            pumpUntil { controller().model.state is SessionState.Error },
        )
        assertEquals("", find<PromptPanel>(ui).text())
    }

    // The next two tests are a matched pair: identical setup and the same restoreLastSubmission()
    // call, differing only in whether the editor already holds a draft. Together they pin the
    // hasDraft() guard -- removing it makes the second test fail. They drive the panel API directly
    // because the guard only matters when the user types during the window between the editor being
    // cleared on submit and the failure landing, which is not deterministically reachable by
    // interleaving a send with settle().
    fun `test restore puts the submission back when the editor is empty`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "submitted message"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        // The send reached the backend and no failure arrived, so nothing has consumed the
        // retained submission yet; the editor was cleared on submit.
        assertEquals(1, rpc.prompts.size)
        assertEquals("", find<PromptPanel>(ui).text())

        find<PromptPanel>(ui).restoreLastSubmission()

        assertEquals("submitted message", find<PromptPanel>(ui).text())
    }

    fun `test restore does not clobber a draft the user already started`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "submitted message"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        assertEquals(1, rpc.prompts.size)
        assertEquals("", find<PromptPanel>(ui).text())

        // The user starts a new draft before anything attempts a restore.
        find<EditorTextField>(ui).text = "a brand new draft"
        find<PromptPanel>(ui).restoreLastSubmission()

        assertEquals("a brand new draft", find<PromptPanel>(ui).text())
    }

    fun `test a confirmed send stops retaining the submission`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "submitted message"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        // The server persists the user message, which confirms the send and releases the draft
        // (a pasted image is held as a full base64 data URL, so it must not be pinned forever).
        emit(ChatEventDto.MessageUpdated("ses_test", message("confirmed_user_msg")))
        assertTrue(
            "the user message never reached the model",
            pumpUntil { controller().model.messages().any { it.info.id == "confirmed_user_msg" } },
        )

        find<PromptPanel>(ui).restoreLastSubmission()

        assertEquals("", find<PromptPanel>(ui).text())
    }

    /**
     * The prompt box stays enabled while a turn streams, so a send can be queued behind one. When
     * the earlier turn ends, that session-scoped TurnEnded must not be mistaken for the queued
     * send's own outcome -- doing so discarded the queued draft before its failure arrived.
     */
    fun `test an earlier turn ending does not discard a queued send's draft`() {
        showMessages()
        rpc.prompts.clear()

        // Send A, and let the server persist its user message so A is confirmed.
        find<EditorTextField>(ui).text = "first message"
        find<PromptPanel>(ui).send()
        assertTrue("send A never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })
        emit(ChatEventDto.MessageUpdated("ses_test", message("queued_msg_a")))
        assertTrue(
            "A's user message never reached the model",
            pumpUntil { controller().model.messages().any { it.info.id == "queued_msg_a" } },
        )

        // Send B while A is still streaming. Its own user message has not been persisted yet.
        rpc.prompts.clear()
        find<EditorTextField>(ui).text = "second message"
        find<PromptPanel>(ui).send()
        assertTrue("send B never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })
        assertEquals("", find<PromptPanel>(ui).text())

        // Turn A ends without completing. This must leave B's pending send untouched.
        emit(ChatEventDto.TurnClose("ses_test", reason = "interrupted"))
        assertTrue(
            "turn A never ended",
            pumpUntil { controller().model.state is SessionState.TurnEnded },
        )

        // B now fails before its message was ever persisted, so its draft must come back.
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "B rejected")))
        assertTrue(
            "B's failure never reached the model",
            pumpUntil { controller().model.state is SessionState.Error },
        )

        assertEquals("second message", find<PromptPanel>(ui).text())
    }

    /**
     * An unreadable attachment makes the CLI publish session.error before it persists the user
     * message and starts the turn anyway. The draft comes back first so nothing is lost, then clears
     * again once the message lands -- it is a duplicate at that point -- leaving Stop on the button.
     */
    fun `test a restored draft clears once the message is persisted`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "check this"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "Cannot read binary file")))
        assertTrue(
            "the draft was never restored",
            pumpUntil { find<PromptPanel>(ui).text() == "check this" },
        )

        emit(ChatEventDto.MessageUpdated("ses_test", message("restored_user_msg")), flush = false)
        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue(
            "the turn never started",
            pumpUntil { controller().model.state is SessionState.Busy },
        )

        val panel = find<PromptPanel>(ui)
        assertEquals("", panel.text())
        assertTrue(panel.isStopEnabled)
        assertSame(AllIcons.Actions.Suspend, panel.buttonForTest().icon)
    }

    /**
     * The clearing above must not clobber a draft the user started editing while the failed-looking
     * send was still landing.
     */
    fun `test an edited restored draft is kept once the message is persisted`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "check this"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "Cannot read binary file")))
        assertTrue(
            "the draft was never restored",
            pumpUntil { find<PromptPanel>(ui).text() == "check this" },
        )

        find<EditorTextField>(ui).text = "check this, edited"
        emit(ChatEventDto.MessageUpdated("ses_test", message("restored_user_msg")), flush = false)
        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue(
            "the turn never started",
            pumpUntil { controller().model.state is SessionState.Busy },
        )

        assertEquals("check this, edited", find<PromptPanel>(ui).text())
    }

    // Reverting puts the message back in the box (text + rebuilt attachment). Sending that draft
    // again must behave like any send: it clears, and stays cleared once the message is persisted.
    fun `test sending a reverted draft does not put it back`() {
        showMessages()
        rpc.prompts.clear()

        val model = controller().model
        model.upsertMessage(message("u1"))
        model.updateContent("u1", part("p1", "u1", "text", "check this"))
        model.updateContent(
            "u1",
            PartDto(
                "n1",
                "ses_test",
                "u1",
                "text",
                text = "Read tool failed to read /tmp/trace.jfr with the following error: Cannot read binary file",
                synthetic = true,
            ),
        )
        model.setRevert(SessionRevertDto("u1"))

        val prompt = find<PromptPanel>(ui)
        assertTrue("revert never restored the draft", pumpUntil { prompt.text() == "check this" })
        assertEquals(1, prompt.attachmentCountForTest())

        prompt.send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })
        assertEquals("", prompt.text())

        // Redoing the reverted message removes it, so the new user message does not raise the count.
        emit(ChatEventDto.MessageRemoved("ses_test", "u1"), flush = false)
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "Cannot read binary file")))
        emit(ChatEventDto.MessageUpdated("ses_test", message("u2")), flush = false)
        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue(
            "the turn never started",
            pumpUntil { controller().model.state is SessionState.Busy },
        )

        assertEquals("", prompt.text())
        assertEquals(0, prompt.attachmentCountForTest())
    }

    // A send that genuinely failed keeps its restored draft even when an unrelated user message
    // shows up afterwards (a redo re-adding a reverted message, or a reload). No turn opens for it,
    // so it must not be treated as confirmation of the failed send.
    fun `test an unrelated message does not drop a draft whose send failed`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "don't lose this"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "boom")))
        assertTrue(
            "the draft was never restored",
            pumpUntil { find<PromptPanel>(ui).text() == "don't lose this" },
        )

        emit(ChatEventDto.MessageUpdated("ses_test", message("unrelated_user_msg")))
        assertTrue(
            "the unrelated message never arrived",
            pumpUntil { controller().model.messages().any { it.info.id == "unrelated_user_msg" } },
        )

        assertEquals("don't lose this", find<PromptPanel>(ui).text())
    }

    // Busy alone does not prove the failed send landed: a retry (of an older failed turn), a login
    // resume, or an auto-approval also enters Busy with no new user message. None may drop the draft.
    fun `test a turn opening without this send's message keeps the failed draft`() {
        showMessages()
        rpc.prompts.clear()

        find<EditorTextField>(ui).text = "don't lose this"
        find<PromptPanel>(ui).send()
        assertTrue("the send never reached the backend", pumpUntil { rpc.prompts.isNotEmpty() })

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "unknown", message = "boom")))
        assertTrue(
            "the draft was never restored",
            pumpUntil { find<PromptPanel>(ui).text() == "don't lose this" },
        )

        // A retry of an older failed turn moves Error -> Busy, with no user message for this send.
        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue(
            "the turn never started",
            pumpUntil { controller().model.state is SessionState.Busy },
        )

        assertEquals("don't lose this", find<PromptPanel>(ui).text())
    }

    @RequiresEdt
    private fun reopen() {
        Disposer.register(testRootDisposable, ui)
        val agents = listOf(AgentDto("plan", mode = "primary"), AgentDto("code", mode = "primary"))
        workspaceRpc.state.value = workspaceRpc.state.value.copy(
            agents = AgentsDto(agents = agents, all = agents, default = "plan"),
            providers = ProvidersDto(
                providers = listOf(ProviderDto("kilo", "Kilo", models = mapOf(
                    "gpt-5" to ModelDto("gpt-5", "GPT-5", variants = listOf("low", "high")),
                    "gpt-6" to ModelDto("gpt-6", "GPT-6", variants = listOf("low", "high")),
                ))),
                connected = listOf("kilo"),
                defaults = mapOf("kilo" to "gpt-5"),
            ),
        )
        ui = newUi("ses_test")
        layout()
    }

    @RequiresEdt
    private fun handoff(automatic: Boolean = true, confirmed: () -> Unit = {}): CompletableDeferred<String> {
        val started = CompletableDeferred<String>()
        assertTrue(ui.handoffPrompt(
            text = "initial prompt",
            select = PromptSelection("plan", "kilo", "gpt-5", "high"),
            message = "msg_handoff",
            automatic = automatic,
            injectedTitle = null,
            started = { started.complete(it) },
            confirmed = confirmed,
        ))
        return started
    }

    @RequiresEdt
    private fun signal(accept: (SessionModelEvent) -> Boolean): CompletableDeferred<Unit> {
        val signal = CompletableDeferred<Unit>()
        controller().model.addListener(ui) {
            assertTrue(ApplicationManager.getApplication().isDispatchThread)
            if (accept(it)) signal.complete(Unit)
        }
        return signal
    }

    @RequiresEdt
    private fun <T> await(signal: CompletableDeferred<T>): T {
        val deadline = System.nanoTime() + TEST_WAIT_MS * 1_000_000
        while (!signal.isCompleted && System.nanoTime() < deadline) {
            settle()
            Thread.yield()
        }
        assertTrue("handoff never reached its expected event; state=${controller().model.state}", signal.isCompleted)
        settle()
        return runBlocking { signal.await() }
    }

    @RequiresEdt
    private fun assertHandoff(
        text: String,
        select: PromptSelection = PromptSelection("plan", "kilo", "gpt-5", "high"),
    ) {
        assertEquals(1, rpc.prompts.size)
        val call = rpc.prompts.single()
        assertEquals("ses_test", call.first)
        assertEquals("/test", call.second)
        assertEquals("msg_handoff", call.third.messageID)
        assertEquals(text, call.third.parts.first().text)
        assertEquals(select.agent, call.third.agent)
        assertEquals(select.provider, call.third.providerID)
        assertEquals(select.model, call.third.modelID)
        assertEquals(select.variant, call.third.variant)
    }
}
