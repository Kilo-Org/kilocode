package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.ui.search.SessionSearchKeys
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.impl.SimpleDataContext as SimpleContext

class TranscriptFindActionTest : SessionUiTestBase() {
    private fun context(): DataContext = SimpleContext.builder()
        .add(SessionSearchKeys.SEARCH, ui.search)
        .build()

    fun `test transcript actions enable only inside a chat`() {
        val empty = SimpleContext.builder().build()
        val event = AnActionEvent.createFromDataContext("test", null, empty)
        val find = TranscriptFindAction()
        find.update(event)
        assertFalse(event.presentation.isEnabled)
        assertFalse(event.presentation.isVisible)
        assertEmpty(find.promote(emptyList(), empty))

        val active = AnActionEvent.createFromDataContext("test", null, context())
        find.update(active)
        assertTrue(active.presentation.isEnabled)
        assertTrue(active.presentation.isVisible)

        val candidates: List<AnAction> = listOf(find)
        assertEquals(listOf(find), find.promote(candidates, context()))
        assertEmpty(find.promote(listOf(TranscriptFindNextAction()), context()))
    }

    fun `test find action opens the native bar`() {
        val event = AnActionEvent.createFromDataContext("test", null, context())
        TranscriptFindAction().actionPerformed(event)
        val bar = ui.search.getComponent()
        assertNotNull(bar.getSearchTextComponent())
        ui.search.close()
    }
}