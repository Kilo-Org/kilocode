package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.WorkspaceFileDto
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

    fun `test searchFiles sends query to RPC`() = runBlocking {
        withContext(Dispatchers.Default) {
            service.searchFiles("/test", "src")
        }

        assertEquals(listOf("src"), rpc.searchQueries)
    }
}
