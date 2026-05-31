package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
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
}
