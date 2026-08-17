package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class WorktreeSessionListControllerTest : BasePlatformTestCase() {
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
