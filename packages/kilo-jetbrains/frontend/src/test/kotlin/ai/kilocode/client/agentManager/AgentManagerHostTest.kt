package ai.kilocode.client.agentManager

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.components.service
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class AgentManagerHostTest : BasePlatformTestCase() {

    // The light test project (and its services, including this one) can be reused across test
    // methods, so a request left queued by one test could otherwise leak into the next and fire
    // against that test's handler with stale arguments. Rebinding a throwaway no-op handler flushes
    // any such leftover request before it can do that.
    override fun tearDown() {
        try {
            edt { host().bind(Disposer.newDisposable(), move = { _, _, _ -> }, newWorktree = {}) }
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

    private fun host(): AgentManagerHost = project.service<AgentManagerHost>()

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
