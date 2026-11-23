package ai.kilocode.client.session

import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.rpc.dto.PromptDto
import kotlinx.coroutines.CompletableDeferred

/**
 * A hosted editor starts blank. The first prompt must create the Cloud session in one call and then
 * skip the normal follow-up send, because the start call already submitted that prompt.
 */
class SessionUiHostedCreateTest : SessionUiTestBase() {
    fun `test first prompt creates the hosted session without sending twice`() {
        val prompts = mutableListOf<PromptDto>()
        val manager = object : SessionManager {
            override val hosted = true
            override fun newSession() = Unit
            override fun showHistory(back: (() -> Unit)?) = Unit
            override fun openSession(ref: SessionRef) = Unit
            override suspend fun createSession(prompt: PromptDto): SessionRef {
                prompts += prompt
                return SessionRef.Hosted("kilo-cloud", "worktree_1", "ses_one", "Created session")
            }
        }
        ui = newUi(null, manager = manager)
        layout()
        settle()

        val panel = find(ui, PromptPanel::class.java)!!
        panel.setText("Start here")
        panel.send()

        assertTrue(pumpUntil { prompts.size == 1 })
        assertEquals("Start here", prompts.single().parts.single().text)
        // The Cloud start call owns the prompt, so the generic prompt endpoint stays untouched.
        assertTrue(pumpUntil { ui.title() == "Created session" })
        assertTrue("hosted creation must not send the prompt twice", rpc.prompts.isEmpty())
    }

    fun `test a prompt sent while the hosted session is still being created is not dropped`() {
        val gate = CompletableDeferred<Unit>()
        val manager = object : SessionManager {
            override val hosted = true
            override fun newSession() = Unit
            override fun showHistory(back: (() -> Unit)?) = Unit
            override fun openSession(ref: SessionRef) = Unit
            override suspend fun createSession(prompt: PromptDto): SessionRef {
                gate.await()
                return SessionRef.Hosted("kilo-cloud", "worktree_1", "ses_one", "Created session")
            }
        }
        ui = newUi(null, manager = manager)
        layout()
        settle()
        val panel = find(ui, PromptPanel::class.java)!!

        panel.setText("first")
        panel.send()
        settle()
        panel.setText("second")
        panel.send()
        settle()
        gate.complete(Unit)

        // The start call carried "first"; "second" joined the same create and still needs its own send.
        assertTrue(pumpUntil { rpc.prompts.size == 1 })
        val sent = rpc.prompts.single()
        assertEquals("hosted:kilo-cloud:worktree_1:ses_one", sent.first)
        assertEquals("second", sent.third.parts.single().text)
    }

    fun `test a failed hosted creation surfaces its error`() {
        val manager = object : SessionManager {
            override val hosted = true
            override fun newSession() = Unit
            override fun showHistory(back: (() -> Unit)?) = Unit
            override fun openSession(ref: SessionRef) = Unit
            override suspend fun createSession(prompt: PromptDto): SessionRef =
                throw IllegalStateException("Cloud session creation failed")
        }
        ui = newUi(null, manager = manager)
        layout()
        settle()

        val panel = find(ui, PromptPanel::class.java)!!
        panel.setText("Start here")
        panel.send()

        assertTrue(pumpUntil { rpc.prompts.isEmpty() })
        assertTrue(pumpUntil { controller(ui).model.state is SessionState.Error })
    }

    private fun controller(ui: SessionUi): SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(ui) as SessionController
    }
}