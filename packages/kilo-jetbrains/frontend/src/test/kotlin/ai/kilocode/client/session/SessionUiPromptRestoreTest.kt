package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto
import com.intellij.ui.EditorTextField

/**
 * Regression coverage for the data-loss bug where a prompt that failed before any message was
 * persisted (an attachment rejected synchronously, or a prompt_async send that returns 204 and
 * then fails asynchronously) permanently lost the user's typed text: the editor was cleared on
 * submit and there was no draft store or prompt history to recover it from. See
 * SessionUi.sendPrompt/onStateChanged and PromptPanel.restoreLastSubmission.
 */
@Suppress("UnstableApiUsage")
class SessionUiPromptRestoreTest : SessionUiTestBase() {

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
}
