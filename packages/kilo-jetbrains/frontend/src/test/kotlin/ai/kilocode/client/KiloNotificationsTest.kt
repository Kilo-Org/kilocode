package ai.kilocode.client

import com.intellij.notification.Notification
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Covers the multi-action overload added for notifications that need more than one expiring
 * action at once (e.g. the nested-worktree delete failure: copy path + reveal in Finder/Explorer).
 */
class KiloNotificationsTest : BasePlatformTestCase() {
    fun `test error notification with multiple actions exposes each label and invokes each callback once`() {
        val calls = mutableListOf<String>()
        val note = notifications {
            KiloNotifications.error(
                project,
                "Title",
                "Body",
                listOf(
                    "First" to { calls += "first" },
                    "Second" to { calls += "second" },
                ),
            )
        }.single()

        assertEquals("Title", note.title)
        assertEquals(listOf("First", "Second"), note.actions.map { it.templateText })

        note.actions.forEach { perform(it, note) }

        assertEquals(listOf("first", "second"), calls)
    }

    fun `test error notification with no actions publishes a plain notification`() {
        val note = notifications {
            KiloNotifications.error(project, "Title", "Body")
        }.single()

        assertEquals("Title", note.title)
        assertTrue(note.actions.isEmpty())
    }

    fun `test single action overload behaves like a one item multi action list`() {
        var called = false
        val note = notifications {
            KiloNotifications.error(project, "Title", null, "Retry") { called = true }
        }.single()

        assertEquals(listOf("Retry"), note.actions.map { it.templateText })
        perform(note.actions.single(), note)
        assertTrue(called)
    }

    private fun perform(action: AnAction, notification: Notification) {
        val context = SimpleDataContext.getSimpleContext(Notification.KEY, notification)
        val event = AnActionEvent.createEvent(
            context,
            Presentation().apply { copyFrom(action.templatePresentation) },
            ActionPlaces.TOOLWINDOW_TITLE,
            ActionUiKind.NONE,
            null,
        )
        action.actionPerformed(event)
    }

    /** Every notification published while [block] runs, on both buses KiloNotifications can reach. */
    private fun notifications(block: () -> Unit): List<Notification> {
        val notes = mutableListOf<Notification>()
        val listener = object : Notifications {
            override fun notify(notification: Notification) {
                notes.add(notification)
            }
        }
        val app = ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
        val proj = project.messageBus.connect(testRootDisposable)
        app.subscribe(Notifications.TOPIC, listener)
        proj.subscribe(Notifications.TOPIC, listener)
        try {
            block()
        } finally {
            app.disconnect()
            proj.disconnect()
        }
        return notes
    }
}
