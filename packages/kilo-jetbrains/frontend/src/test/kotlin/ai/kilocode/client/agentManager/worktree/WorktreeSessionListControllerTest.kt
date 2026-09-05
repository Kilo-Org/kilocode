package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.SessionChangeDto
import ai.kilocode.rpc.dto.SessionChangeKindDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class WorktreeSessionListControllerTest : BasePlatformTestCase() {
    private companion object {
        /**
         * How long to keep pumping while proving a reload never happens. Must comfortably exceed
         * the controller's change-coalescing window; positive waits use the shared default deadline.
         */
        const val QUIET_MS = 1_500L
    }

    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var controller: WorktreeSessionListController

    private val dir = "/repo/.kilo/worktrees/feature-x"

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, coroutines.scope, rpc)
        controller = WorktreeSessionListController(sessions, dir, coroutines.scope, telemetry = { _, _ -> })
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test reload populates the model from the directory listing`() {
        rpc.listed += session("ses_1", "One")
        rpc.listed += session("ses_2", "Two")

        controller.reload()
        drain()

        assertEquals(2, controller.model.size)
        assertEquals(setOf("ses_1", "ses_2"), controller.sessions().map { it.id }.toSet())
    }

    fun `test reload does not clobber the shared sessions flow`() {
        // The shared flow reflects a different directory; a worktree reload must not overwrite it.
        rpc.listed += session("ses_main", "Main")
        kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.Default) { sessions.list("/repo") }
        assertEquals(listOf("ses_main"), sessions.sessions.value.map { it.id })

        rpc.listed.clear()
        rpc.listed += session("ses_wt", "Worktree")
        controller.reload()
        drain()

        assertEquals(listOf("ses_wt"), controller.sessions().map { it.id })
        assertEquals(listOf("ses_main"), sessions.sessions.value.map { it.id })
    }

    fun `test create prepends the new session and keeps existing rows`() {
        rpc.listed += session("existing", "Existing")
        controller.reload()
        drain()

        var created: SessionDto? = null
        controller.create { created = it }
        drain()

        assertEquals("ses_test", created?.id)
        assertEquals("ses_test", controller.model.getElementAt(0).id)
        assertTrue(controller.sessions().any { it.id == "existing" })
    }

    fun `test delete removes the session and reports success`() {
        rpc.listed += session("ses_1", "One")
        rpc.listed += session("ses_2", "Two")
        controller.reload()
        drain()

        var ok: Boolean? = null
        controller.delete("ses_1") { success, _ -> ok = success }
        drain()

        assertEquals(true, ok)
        assertNull(controller.session("ses_1"))
        assertNotNull(controller.session("ses_2"))
    }

    fun `test delete failure reports the error and reloads`() {
        rpc.listed += session("ses_1", "One")
        controller.reload()
        drain()
        rpc.deleteThrows = RuntimeException("boom")

        var err: String? = null
        var ok: Boolean? = null
        controller.delete("ses_1") { success, message -> ok = success; err = message }
        drain()

        assertEquals(false, ok)
        assertEquals("boom", err)
        // The failed delete never removed ses_1 from the backend, so the reload restores it.
        assertNotNull(controller.session("ses_1"))
    }

    fun `test rename applies optimistically and keeps the server title on success`() {
        rpc.listed += session("ses_1", "Old")
        controller.reload()
        drain()

        edtWait { controller.rename("ses_1", "New") { _, _ -> } }
        // Optimistic title is visible before the RPC resolves.
        assertEquals("New", controller.session("ses_1")?.title)

        drain()
        assertEquals("New", controller.session("ses_1")?.title)
        assertEquals(Triple("ses_1", dir, "New"), rpc.renames.single())
    }

    fun `test rename failure reverts to the prior title`() {
        rpc.listed += session("ses_1", "Old")
        controller.reload()
        drain()
        rpc.renameThrows = RuntimeException("nope")

        var err: String? = null
        edtWait { controller.rename("ses_1", "New") { _, message -> err = message } }
        drain()

        assertEquals("nope", err)
        assertEquals("Old", controller.session("ses_1")?.title)
    }

    fun `test a session change in this directory brings in the new session`() {
        rpc.listed += session("ses_1", "One")
        controller.reload()
        drain()
        val before = rpc.lists.size

        // A session started elsewhere in this worktree, then two title updates as it streams. The
        // burst is emitted back to back so the coalescing window sees it as one.
        rpc.listed += session("ses_from_other_frame", "Elsewhere")
        emit(
            change("ses_from_other_frame", dir, SessionChangeKindDto.CREATED),
            change("ses_from_other_frame", dir, SessionChangeKindDto.UPDATED),
            change("ses_from_other_frame", dir, SessionChangeKindDto.UPDATED),
        )

        assertTrue(coroutines.pumpUntil { controller.session("ses_from_other_frame") != null })
        // Coalesced: a burst costs one reload, not one per event.
        assertEquals(1, rpc.lists.size - before)
    }

    fun `test a session change in another directory is ignored`() {
        controller.reload()
        drain()
        val before = rpc.lists.size

        emit(change("ses_main", "/repo", SessionChangeKindDto.CREATED))
        // Waiting past the coalescing window proves no reload was merely pending.
        assertFalse(coroutines.pumpUntil(QUIET_MS) { rpc.lists.size > before })
    }

    fun `test a session change matches a directory with a trailing separator`() {
        controller.reload()
        drain()
        val before = rpc.lists.size

        emit(change("ses_1", "$dir/", SessionChangeKindDto.CREATED))

        assertTrue(coroutines.pumpUntil { rpc.lists.size > before })
    }

    /**
     * Emits into the fake's change flow from a background thread. The flow has no replay, so the
     * controller's collector must already be subscribed — every caller reloads and drains first.
     */
    private fun emit(vararg values: SessionChangeDto) {
        kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.Default) {
            values.forEach { rpc.changes.emit(it) }
        }
    }

    private fun change(id: String, directory: String, kind: SessionChangeKindDto) =
        SessionChangeDto(id, directory, kind)

    private fun session(id: String, title: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = dir,
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private fun drain() = coroutines.drain(::pump)

    private fun pump() = pumpEdt()
}
