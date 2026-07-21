package ai.kilocode.client.session

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.WorkspaceFileDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.isManagedWorktreeStorage
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import javax.swing.JPanel

class SessionFileLinksTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var service: KiloWorkspaceService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
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

    fun `test parse keeps plain path without location`() {
        assertEquals(SessionFileLinks.Target("src/Foo.kt"), SessionFileLinks.parse("src/Foo.kt"))
    }

    fun `test parse strips line range and column suffixes`() {
        assertEquals(SessionFileLinks.Target("src/Foo.kt", line = 12), SessionFileLinks.parse("src/Foo.kt:12"))
        assertEquals(SessionFileLinks.Target("src/Foo.kt", line = 12), SessionFileLinks.parse("src/Foo.kt:12-20"))
        assertEquals(SessionFileLinks.Target("src/Foo.kt", line = 12, column = 3), SessionFileLinks.parse("src/Foo.kt:12:3"))
    }

    fun `test parse preserves encoded path`() {
        assertEquals(SessionFileLinks.Target("src/a%20file.kt", line = 8), SessionFileLinks.parse("src/a%20file.kt:8"))
    }

    fun `test isFileHref separates file refs from urls`() {
        assertTrue(SessionFileLinks.isFileHref("src/Foo.kt"))
        assertTrue(SessionFileLinks.isFileHref("file:///tmp/Foo.kt"))
        assertTrue(SessionFileLinks.isFileHref("C:\\repo\\Foo.kt"))
        assertFalse(SessionFileLinks.isFileHref("https://kilocode.ai/docs"))
        assertFalse(SessionFileLinks.isFileHref("mailto:test@example.com"))
        assertFalse(SessionFileLinks.isFileHref("ftp://example.com/file.txt"))
    }

    fun `test decide returns resolution from open state and candidates`() {
        val one = WorkspaceFileDto("src/Foo.kt", "Foo.kt")
        val two = WorkspaceFileDto("test/Foo.kt", "Foo.kt")

        assertEquals(SessionFileLinks.Resolution.Opened, SessionFileLinks.decide(true, emptyList()))
        assertEquals(SessionFileLinks.Resolution.Missing, SessionFileLinks.decide(false, emptyList()))
        assertEquals(SessionFileLinks.Resolution.OpenDirect(one), SessionFileLinks.decide(false, listOf(one)))
        assertEquals(SessionFileLinks.Resolution.Choose(listOf(one, two)), SessionFileLinks.decide(false, listOf(one, two)))
    }

    fun `test managed worktree storage filter only rejects worktree subtree`() {
        assertFalse(isManagedWorktreeStorage("backend/src/Main.java"))
        assertFalse(isManagedWorktreeStorage(".kilo/plans/x.md"))
        assertTrue(isManagedWorktreeStorage(".kilo/worktrees"))
        assertTrue(isManagedWorktreeStorage(".kilo/worktrees/foo/backend/src/Main.java"))
    }

    fun `test open falls back to decoded search query and opens match`() = runBlocking {
        val file = WorkspaceFileDto("/test/src/a file.kt", "a file.kt")
        val done = CompletableDeferred<Unit>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        rpc.fileResolver = { path -> if (path == file.path) listOf(file) else emptyList() }
        rpc.search = { FileSearchResultDto(files = listOf(file)) }
        val links = SessionFileLinks("/test", service, scope, JPanel(), openUrl = {}) { event, props ->
            events.add(event to props)
            done.complete(Unit)
        }

        links.open("src/a%20file.kt:8", null)
        withTimeout(OPEN_TIMEOUT_MS) { done.await() }

        assertEquals(listOf("a file.kt"), rpc.searchQueries)
        assertEquals(listOf(FakeWorkspaceRpcApi.Opened("/test/src/a file.kt", 8, null)), rpc.openedFiles)
        assertEquals("File Link Opened", events.single().first)
        assertEquals("search_direct", events.single().second["result"])
        assertEquals("true", events.single().second["hasLine"])
    }

    private companion object {
        const val OPEN_TIMEOUT_MS = 5_000L
    }
}
