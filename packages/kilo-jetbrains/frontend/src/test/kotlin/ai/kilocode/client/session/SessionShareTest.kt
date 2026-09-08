package ai.kilocode.client.session

import ai.kilocode.client.actions.CopyShareLinkAction
import ai.kilocode.client.actions.ShareSessionAction
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.SessionShareDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.ide.CopyPasteManager
import java.awt.datatransfer.DataFlavor

/**
 * Share/unshare through the real controller and service against the fake RPC: the calls that reach the
 * backend, the clipboard write, and the model state the menu item's label reads.
 */
@Suppress("UnstableApiUsage")
class SessionShareTest : SessionUiTestBase() {

    fun `test reopening a shared session exposes sharing actions before any update`() {
        rpc.session = rpc.session.copy(share = SessionShareDto(rpc.shareUrl))
        open()

        val action = ShareSessionAction()
        val shared = event(action)
        ActionUtil.updateAction(action, shared)

        assertEquals(rpc.shareUrl, actions().share)
        assertTrue(shared.presentation.isEnabledAndVisible)
        assertEquals("Stop Sharing", shared.presentation.text)

        val copy = CopyShareLinkAction()
        val link = event(copy)
        ActionUtil.updateAction(copy, link)
        assertTrue(link.presentation.isEnabledAndVisible)
        copy.actionPerformed(link)

        assertEquals(rpc.shareUrl, clipboard())
        assertTrue(rpc.shares.isEmpty())
    }

    fun `test share calls the backend and copies the link`() {
        open()

        actions().startShare()
        settle()

        assertEquals(listOf(Triple("ses_test", "/test", true)), rpc.shares)
        assertEquals("https://app.kilo.ai/s/token", clipboard())
        assertEquals("https://app.kilo.ai/s/token", actions().share)
    }

    fun `test unshare calls the backend and clears the link`() {
        open()
        rpc.listed.add(session("ses_test").copy(share = SessionShareDto("https://app.kilo.ai/s/token")))
        controller().model.setSession(session("ses_test").copy(share = SessionShareDto("https://app.kilo.ai/s/token")))
        assertNotNull(actions().share)

        actions().stopShare()
        settle()

        assertEquals(listOf(Triple("ses_test", "/test", false)), rpc.shares)
        assertNull(actions().share)
    }

    fun `test share failure leaves the session unshared`() {
        open()
        rpc.shareThrows = IllegalStateException("HTTP 500")

        actions().startShare()
        settle()

        assertEquals(listOf(Triple("ses_test", "/test", true)), rpc.shares)
        assertNull(actions().share)
    }

    fun `test share state from a session updated event flips the action label`() {
        open()
        val action = ShareSessionAction()

        val before = event(action)
        ActionUtil.updateAction(action, before)
        assertEquals("Share Session", before.presentation.text)

        emit(
            ChatEventDto.SessionUpdated(
                "ses_test",
                session("ses_test").copy(share = SessionShareDto("https://app.kilo.ai/s/tok")),
            ),
        )

        val after = event(action)
        ActionUtil.updateAction(action, after)
        assertEquals("Stop Sharing", after.presentation.text)
    }

    fun `test share is unavailable before the session exists`() {
        // A blank chat has no id until the first prompt, so there is nothing to share yet.
        assertNull(actions().id)

        val action = ShareSessionAction()
        val event = event(action)
        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
        assertTrue(rpc.shares.isEmpty())
    }

    private fun open() {
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        layout()
    }

    private fun actions(): SessionActions = ui

    private fun event(action: AnAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id ->
            if (SessionActionsKeys.ACTIONS.`is`(id)) actions() else null
        }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private fun clipboard(): String? =
        CopyPasteManager.getInstance().contents?.getTransferData(DataFlavor.stringFlavor) as? String
}
