package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.components.service
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

class KiloInlineDiffStoreTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var workspace: FakeWorkspaceRpcApi
    private lateinit var service: KiloDiffEditorService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        workspace = FakeWorkspaceRpcApi()
        service = KiloDiffEditorService(project, coroutines.scope)
        project.replaceService(KiloInlineDiffStore::class.java, KiloInlineDiffStore(), testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, workspace), testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close { UIUtil.dispatchAllInvocationEvents() }
        } finally {
            super.tearDown()
        }
    }

    fun `test pop returns then clears while get remains persistent`() {
        val store = project.service<KiloInlineDiffStore>()
        val files = listOf(file("src/A.kt", 2, 1))

        store.put("inline", files)
        assertEquals(files, store.get("inline"))
        assertEquals(files, store.get("inline"))

        store.put("branch:/test", files)
        assertEquals(files, store.pop("branch:/test"))
        assertNull(store.pop("branch:/test"))
    }

    fun `test branch fetch recomputes authoritatively and ignores any store seed`() = runBlocking {
        val store = project.service<KiloInlineDiffStore>()
        val stale = listOf(file("src/Stale.kt", 3, 1))
        val fresh = file("src/Fresh.kt", 1, 0)
        workspace.branchDiffs.add(fresh)
        workspace.branchName = "main"
        // A leftover seed under the branch token must never be consumed as a side channel: it would
        // otherwise poison a re-open or Refresh with content from an earlier click.
        store.put("branch:/test", stale)
        val params = diffParams("branch", "/test", null, "Branch", "main")

        val first = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files
        val second = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files

        assertEquals(listOf(fresh), first.files)
        assertEquals(listOf(fresh), second.files)
        assertEquals(listOf("/test", "/test"), workspace.branchDiffCalls)
        assertEquals(stale, store.get("branch:/test"))
    }

    private fun file(path: String, additions: Int, deletions: Int) = DiffFileDto(path, additions, deletions)
}
