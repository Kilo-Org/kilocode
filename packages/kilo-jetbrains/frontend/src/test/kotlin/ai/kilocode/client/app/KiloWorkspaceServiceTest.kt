package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.rpc.dto.WorkspaceFileDto
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

@Suppress("UnstableApiUsage")
class KiloWorkspaceServiceTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var service: KiloWorkspaceService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeWorkspaceRpcApi()
        service = KiloWorkspaceService(scope, rpc)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test openPath opens first file match`() = runBlocking {
        rpc.fileMatches = listOf(
            WorkspaceFileDto("/test/.kilo/plans/a.md", "a.md"),
            WorkspaceFileDto("/other/.kilo/plans/a.md", "a.md"),
        )

        val ok = withContext(Dispatchers.Default) {
            service.openPath("/test", ".kilo/plans/a.md")
        }

        assertTrue(ok)
        assertEquals(listOf("/test" to ".kilo/plans/a.md"), rpc.fileCalls)
        assertEquals(listOf("/test/.kilo/plans/a.md"), rpc.opened)
    }

    fun `test openPath passes line and column to backend`() = runBlocking {
        rpc.fileMatches = listOf(WorkspaceFileDto("/test/src/Foo.kt", "Foo.kt"))

        val ok = withContext(Dispatchers.Default) {
            service.openPath("/test", "src/Foo.kt", line = 12, column = 3)
        }

        assertTrue(ok)
        assertEquals(listOf(FakeWorkspaceRpcApi.Opened("/test/src/Foo.kt", 12, 3)), rpc.openedFiles)
    }

    fun `test openPath returns false when no match exists`() = runBlocking {
        val ok = withContext(Dispatchers.Default) {
            service.openPath("/test", ".kilo/plans/missing.md")
        }

        assertFalse(ok)
        assertEquals(listOf("/test" to ".kilo/plans/missing.md"), rpc.fileCalls)
        assertTrue(rpc.opened.isEmpty())
    }

    fun `test openPath returns false when backend open fails`() = runBlocking {
        rpc.fileMatches = listOf(WorkspaceFileDto("/test/.kilo/plans/a.md", "a.md"))
        rpc.openResult = false

        val ok = withContext(Dispatchers.Default) {
            service.openPath("/test", ".kilo/plans/a.md")
        }

        assertFalse(ok)
        assertEquals(listOf("/test/.kilo/plans/a.md"), rpc.opened)
    }

    fun `test searchFiles rethrows cancellation`() = runBlocking {
        val err = CancellationException("stale completion")
        rpc.search = { throw err }

        val seen = try {
            withContext(Dispatchers.Default) {
                service.searchFiles("/test", "dep")
            }
            fail("expected cancellation")
            null
        } catch (e: CancellationException) {
            e
        }

        assertEquals(err.message, seen?.message)
        assertEquals(listOf("dep"), rpc.searchQueries)
    }

    fun `test refreshConfigFiles logs backend failure and completes`() = runBlocking {
        rpc.refreshConfigThrows = IllegalStateException("backend unavailable")

        val job = service.refreshConfigFiles("/test")
        job.join()

        assertTrue(job.isCompleted)
        assertEquals(listOf("/test"), rpc.refreshedConfigs.toList())
        assertEquals(0, rpc.localConfigPathCalls)
        assertEquals(0, rpc.globalConfigPathCalls)
    }

    fun `test comparison wrappers preserve contents and patches flags`() = runBlocking {
        val base = DiffFileDto("src/Base.kt", 1, 1, before = "base", after = "head")
        val local = DiffFileDto("src/Local.kt", 2, 1, before = "head", after = "working")
        rpc.branchDiffs.add(base)
        rpc.localDiffs.add(local)

        withContext(Dispatchers.Default) {
            assertEquals(listOf(base), service.branchDiff("/test"))
            assertEquals(listOf(base), service.branchDiff("/test", patches = false))
            assertEquals(listOf(local), service.localDiff("/other"))
            assertEquals(listOf(local), service.localDiff("/other", patches = false))
        }

        assertEquals(listOf("/test", "/test"), rpc.branchDiffCalls)
        assertEquals(listOf("/other", "/other"), rpc.localDiffCalls)
        assertEquals(listOf(true, false), rpc.branchDiffPatchCalls)
        assertEquals(listOf(true, false), rpc.localDiffPatchCalls)
    }

    fun `test comparison failures and cancellation propagate`() = runBlocking {
        for (err in listOf(IllegalStateException("unavailable"), CancellationException("cancelled"))) {
            rpc.beforeBranchDiff = { throw err }
            rpc.beforeLocalDiff = { throw err }
            for (local in listOf(false, true)) {
                val failure = withContext(Dispatchers.Default) {
                    runCatching {
                        if (local) service.localDiff("/test") else service.branchDiff("/test")
                    }.exceptionOrNull()
                }
                assertSame(err, failure)
            }
        }
    }

    fun `test branch lookup preserves detached SHA and cancellation`() = runBlocking {
        rpc.branchName = "a1b2c3d"
        val name = withContext(Dispatchers.Default) { service.branchName("/test") }
        assertEquals("a1b2c3d", name)

        val err = CancellationException("cancelled")
        rpc.beforeBranchName = { throw err }
        val failure = withContext(Dispatchers.Default) { runCatching { service.branchName("/test") }.exceptionOrNull() }
        assertSame(err, failure)
        assertEquals(listOf("/test", "/test"), rpc.branchNameCalls)
    }

    fun `test searchFiles sends query to RPC`() = runBlocking {
        withContext(Dispatchers.Default) {
            service.searchFiles("/test", "src")
        }

        assertEquals(listOf("src"), rpc.searchQueries)
    }

    fun `test ifSetupScriptExists invokes callback when a script is configured`() = runBlocking {
        rpc.setupScriptExists = true
        rpc.setupScriptPath = "/test/.kilo/setup-script"
        var seen: String? = null

        service.ifSetupScriptExists("/test") { seen = it.path }.join()
        pumpEdt()

        assertEquals("/test/.kilo/setup-script", seen)
        assertEquals(listOf("/test"), rpc.setupScriptTargetCalls.toList())
    }

    fun `test ifSetupScriptExists is silent when no script is configured`() = runBlocking {
        rpc.setupScriptExists = false
        var called = false

        service.ifSetupScriptExists("/test") { called = true }.join()
        pumpEdt()

        assertFalse(called)
        assertEquals(listOf("/test"), rpc.setupScriptTargetCalls.toList())
    }
}
