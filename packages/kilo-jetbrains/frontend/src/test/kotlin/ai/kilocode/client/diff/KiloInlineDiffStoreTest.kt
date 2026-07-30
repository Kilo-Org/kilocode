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

    fun `test branch fetch consumes seeded snapshot before recomputing`() = runBlocking {
        val store = project.service<KiloInlineDiffStore>()
        val seed = listOf(file("src/Seed.kt", 3, 1))
        val fresh = file("src/Fresh.kt", 1, 0)
        workspace.branchDiffs.add(fresh)
        workspace.branchName = "main"
        store.put("branch:/test", seed)
        val params = diffParams("branch", "/test", null, "Branch", "main", token = "branch:/test")

        val first = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files
        val second = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files

        assertEquals(seed, first.files)
        assertEquals(listOf(fresh), second.files)
        assertEquals(listOf("/test"), workspace.branchDiffCalls)
    }

    private fun file(path: String, additions: Int, deletions: Int) = DiffFileDto(path, additions, deletions)
}
