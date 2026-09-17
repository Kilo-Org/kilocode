package ai.kilocode.client.agentManager

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.components.service
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class AgentManagerHostTest : BasePlatformTestCase() {

    // The light test project (and its services, including this one) can be reused across test methods,
    // so a request left queued by one test would otherwise fire against the next test's handler with
    // stale arguments. Binding a throwaway no-op handler swallows any such leftover, and disposing it
    // right away -- as the newest binding, so its disposer is the one that still owns the callbacks --
    // hands the next test an unbound host.
    override fun tearDown() {
        try {
            val reset = Disposer.newDisposable("host reset")
            edt { host().bind(reset, move = { _, _, _ -> }, newWorktree = {}) }
            edt { Disposer.dispose(reset) }
        } finally {
            super.tearDown()
        }
    }

    fun `test move invokes the bound handler directly`() {
        val host = host()
        val moves = mutableListOf<Triple<String?, String, String>>()
        edt { host.bind(testRootDisposable, move = { id, dir, surface -> moves += Triple(id, dir, surface) }, newWorktree = {}) }

        edt { host.move("ses_1", "/repo/wt", "worktree_editor") }

        assertEquals(listOf(Triple<String?, String, String>("ses_1", "/repo/wt", "worktree_editor")), moves)
    }

    fun `test new worktree invokes the bound handler directly`() {
        val host = host()
        var calls = 0
        edt { host.bind(testRootDisposable, move = { _, _, _ -> }, newWorktree = { calls++ }) }

        edt { host.newWorktree() }

        assertEquals(1, calls)
    }

    fun `test move queues and flushes once a handler binds`() {
        val host = host()
        val moves = mutableListOf<Triple<String?, String, String>>()

        edt { host.move("ses_1", "/repo/wt", "session_list") }
        assertTrue(moves.isEmpty())

        edt { host.bind(testRootDisposable, move = { id, dir, surface -> moves += Triple(id, dir, surface) }, newWorktree = {}) }

        assertEquals(listOf(Triple<String?, String, String>("ses_1", "/repo/wt", "session_list")), moves)
    }

    fun `test new worktree queues and flushes once a handler binds`() {
        val host = host()
        var calls = 0

        edt { host.newWorktree() }
        assertEquals(0, calls)

        edt { host.bind(testRootDisposable, move = { _, _, _ -> }, newWorktree = { calls++ }) }

        assertEquals(1, calls)
    }

    fun `test only the latest queued request survives while unbound`() {
        val host = host()
        val moves = mutableListOf<Triple<String?, String, String>>()

        edt { host.move("ses_1", "/repo/wt", "session_list") }
        edt { host.move("ses_2", "/repo/wt", "session_list") }
        edt { host.bind(testRootDisposable, move = { id, dir, surface -> moves += Triple(id, dir, surface) }, newWorktree = {}) }

        assertEquals(listOf(Triple<String?, String, String>("ses_2", "/repo/wt", "session_list")), moves)
    }

    fun `test handlers clear when the bound tool window is disposed`() {
        val host = host()
        val moves = mutableListOf<Triple<String?, String, String>>()
        val toolWindow = Disposer.newDisposable("fake tool window")
        edt { host.bind(toolWindow, move = { id, dir, surface -> moves += Triple(id, dir, surface) }, newWorktree = {}) }
        edt { Disposer.dispose(toolWindow) }

        edt { host.move("ses_1", "/repo/wt", "session_list") }

        assertTrue(moves.isEmpty())
    }

    fun `test disposing a replaced tool window leaves the newer handlers installed`() {
        // A plugin reload creates the replacement tool window before disposing the old one, so the old
        // disposable fires last and must not take the live callbacks with it.
        val host = host()
        val old = mutableListOf<String?>()
        val new = mutableListOf<String?>()
        val first = Disposer.newDisposable("old tool window")
        edt { host.bind(first, move = { id, _, _ -> old += id }, newWorktree = {}) }
        edt { host.bind(testRootDisposable, move = { id, _, _ -> new += id }, newWorktree = {}) }

        edt { Disposer.dispose(first) }
        edt { host.move("ses_1", "/repo/wt", "session_list") }

        assertEquals(listOf<String?>("ses_1"), new)
        assertTrue(old.isEmpty())
    }

    private fun host(): AgentManagerHost = project.service<AgentManagerHost>()

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
