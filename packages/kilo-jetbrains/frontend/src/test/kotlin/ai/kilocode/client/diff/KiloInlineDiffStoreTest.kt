package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.KiloTelemetryService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.components.service
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import java.util.concurrent.CopyOnWriteArrayList
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

class KiloInlineDiffStoreTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var workspace: FakeWorkspaceRpcApi
    private lateinit var session: FakeSessionRpcApi
    private lateinit var service: KiloDiffEditorService
    private val sides = CopyOnWriteArrayList<Triple<String?, String, String?>>()

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        workspace = FakeWorkspaceRpcApi()
        session = FakeSessionRpcApi()
        service = KiloDiffEditorService(project, coroutines.scope)
        val rpc = object : KiloSessionRpcApi by session {
            override suspend fun diffSides(sessionId: String?, directory: String, file: DiffFileDto, messageId: String?): DiffFileDto? {
                sides.add(Triple(sessionId, directory, messageId))
                return session.diffSides(sessionId, directory, file, messageId)
            }
        }
        val app = FakeAppRpcApi().apply { state.value = KiloAppStateDto(KiloAppStatusDto.READY) }
        project.replaceService(KiloInlineDiffStore::class.java, KiloInlineDiffStore(), testRootDisposable)
        project.replaceService(KiloDiffEditorService::class.java, service, testRootDisposable)
        project.replaceService(KiloSessionService::class.java, KiloSessionService(project, coroutines.scope, rpc), testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, workspace), testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(KiloAppService::class.java, KiloAppService(coroutines.scope, app), testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(KiloTelemetryService::class.java, KiloTelemetryService(coroutines.scope, app), testRootDisposable)
    }

    override fun tearDown() {
        try {
            FileEditorManager.getInstance(project).let { manager -> manager.openFiles.forEach { manager.closeFile(it) } }
            coroutines.close { UIUtil.dispatchAllInvocationEvents() }
            ApplicationManager.getApplication().getService(KiloEditorKindRegistry::class.java).unregister(KiloDiffEditorKind.ID)
            KiloVirtualFileSystem.getInstance().clear()
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

    fun `test comparisons route independently and bypass drifted enrichment`() = runBlocking {
        val patch = "@@ -1 +1 @@\n-before\n+after"
        val base = DiffFileDto("src/Committed.kt", 1, 1, patch, before = "base\n", after = "committed\n")
        val local = DiffFileDto("src/Local.kt", 1, 1, patch, before = "head\n", after = "working\n")
        val rename = DiffFileDto("src/Renamed.kt", 0, 0, before = "same\n", after = "same\n")
        workspace.branchDiffs.addAll(listOf(base, rename))
        workspace.localDiffs.addAll(listOf(local, rename))
        session.diffSides[base.file] = base.copy(after = "drifted local edit\n")
        session.diffSides[local.file] = local.copy(after = "drifted after request\n")
        session.diffSides[rename.file] = rename.copy(after = "deleted locally\n")

        for (comparison in KiloDiffComparison.entries) {
            val params = diffParams(comparison.source, "/test", null, "Changes", "feature/topic")
            val data = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files
            assertEquals(listOf(if (comparison == KiloDiffComparison.BASE) base else local, rename), data.files)
            assertEquals("feature/topic", data.branch)
        }

        assertEquals(listOf("/test"), workspace.branchDiffCalls)
        assertEquals(listOf("/test"), workspace.localDiffCalls)
        assertEquals(listOf(true), workspace.branchDiffPatchCalls)
        assertEquals(listOf(true), workspace.localDiffPatchCalls)
        assertTrue(sides.isEmpty())
        assertTrue(workspace.branchNameCalls.isEmpty())
    }

    fun `test patch-only comparisons do not request snapshot sides`() = runBlocking {
        val file = DiffFileDto("src/A.kt", 1, 1, "@@ -1 +1 @@\n-base\n+head")
        workspace.branchDiffs.add(file)
        workspace.localDiffs.add(file)
        session.diffSides[file.file] = file.copy(before = "wrong base", after = "local drift")
        for (comparison in KiloDiffComparison.entries) {
            val data = withContext(coroutines.dispatcher) {
                service.fetch(diffParams(comparison.source, "/test", null, "Changes"))
            } as DiffEditorData.Files
            assertEquals(listOf(file), data.files)
        }
        assertTrue(sides.isEmpty())
    }

    fun `test session turn tool and inline still enrich while revert stays scoped`() = runBlocking {
        val file = DiffFileDto("src/A.kt", 1, 1, "@@ -1 +1 @@\n-old\n+new")
        val full = file.copy(before = "whole before", after = "whole after")
        session.diffs["ses_1"] = mutableListOf(file)
        session.diffSides[file.file] = full
        val store = project.service<KiloInlineDiffStore>()
        for (token in listOf(null, "turn:ses_1:msg1", "tool:ses_1:msg2", "inline")) {
            if (token != null) store.put(token, listOf(file))
            val params = diffParams(if (token == null) "session" else "inline", "/test", "ses_1", "Session", token = token)
            val data = withContext(coroutines.dispatcher) { service.fetch(params) } as DiffEditorData.Files
            assertEquals(listOf(full), data.files)
        }
        assertEquals(listOf(null, "msg1", "msg2", null), sides.map { it.third })
        assertTrue(sides.all { it.first == "ses_1" && it.second == "/test" })

        store.put("revert:ses_1:msg1", listOf(file))
        val data = withContext(coroutines.dispatcher) {
            service.fetch(diffParams("inline", "/test", "ses_1", "Revert", token = "revert:ses_1:msg1"))
        } as DiffEditorData.Files
        assertEquals(listOf(file), data.files)
        assertEquals(4, sides.size)
        assertTrue(workspace.branchDiffCalls.isEmpty())
        assertTrue(workspace.localDiffCalls.isEmpty())
    }

    fun `test known and looked-up branch reuse normalized comparison tabs`() {
        workspace.branchName = "feature/topic"
        for (comparison in KiloDiffComparison.entries) {
            openKiloDiff(project, "/repo/work/../wt//", comparison, "feature/topic")
            val file = opened().single { it.path.params["source"] == comparison.source }
            val params = diffParams(comparison.source, "/repo/wt", null, comparison.title("feature/topic"), "feature/topic")
            assertEquals(params, file.path.params)
            assertEquals(comparison.title("feature/topic"), file.name)
            assertTrue(workspace.branchNameCalls.isEmpty())

            openKiloDiff(project, "/repo/./wt/", comparison)
            coroutines.drain()

            assertEquals(listOf("/repo/wt"), workspace.branchNameCalls)
            assertSame(file, opened().single { it.path.params["source"] == comparison.source })
            assertEquals(params, file.path.params)
            workspace.branchNameCalls.clear()
        }
        assertEquals(2, opened().size)
    }

    fun `test detached lookup and known SHA share Windows path identity`() {
        workspace.branchName = "a1b2c3d"
        openKiloDiff(project, "C:\\repo\\temp\\..\\wt\\", KiloDiffComparison.LOCAL)
        coroutines.drain()
        val file = opened().single()
        assertEquals("C:/repo/wt", file.path.params["directory"])
        assertEquals("a1b2c3d", file.path.params["branch"])
        assertEquals(KiloBundle.message("diff.editor.local.title.named", "a1b2c3d"), file.name)
        assertEquals(listOf("C:/repo/wt"), workspace.branchNameCalls)

        openKiloDiff(project, "C:/repo/wt/", KiloDiffComparison.LOCAL, "a1b2c3d")
        assertSame(file, opened().single())
    }

    fun `test unavailable branch uses stable generic comparison title`() {
        for (comparison in KiloDiffComparison.entries) {
            openKiloDiff(project, "/repo", comparison)
            coroutines.drain()
            val file = opened().single { it.path.params["source"] == comparison.source }
            assertNull(file.path.params["branch"])
            assertEquals(comparison.title(null), file.name)
            openKiloDiff(project, "/repo/", comparison, " ")
            coroutines.drain()
            assertSame(file, opened().single { it.path.params["source"] == comparison.source })
        }
    }

    fun `test closing and reopening local comparison fetches again without seeds`() {
        val manager = FileEditorManager.getInstance(project)
        val store = project.service<KiloInlineDiffStore>()
        val stale = listOf(file("src/Stale.kt", 3, 1))
        store.put("local:/test", stale)
        openKiloDiff(project, "/test", KiloDiffComparison.LOCAL, "main")
        val first = opened().single()
        assertNotNull(manager.getSelectedEditor(first)?.component)
        coroutines.drain()
        assertEquals(listOf("/test"), workspace.localDiffCalls)
        manager.closeFile(first)

        openKiloDiff(project, "/test/", KiloDiffComparison.LOCAL, "main")
        assertNotNull(manager.getSelectedEditor(opened().single())?.component)
        coroutines.drain()
        assertEquals(first.path.params, opened().single().path.params)
        assertEquals(listOf("/test", "/test"), workspace.localDiffCalls)
        assertTrue(workspace.branchDiffCalls.isEmpty())
        assertEquals(stale, store.get("local:/test"))
    }

    fun `test disposing opener parent cancels lookup and never opens a tab`() {
        val gate = CompletableDeferred<Unit>()
        val cancelled = CompletableDeferred<Unit>()
        val parent = Disposer.newDisposable(testRootDisposable)
        workspace.beforeBranchName = {
            try {
                gate.await()
            } finally {
                cancelled.complete(Unit)
            }
        }
        openKiloDiff(project, "/test", KiloDiffComparison.LOCAL, parent = parent)
        coroutines.drain()
        assertEquals(listOf("/test"), workspace.branchNameCalls)

        Disposer.dispose(parent)
        coroutines.drain()
        assertTrue(cancelled.isCompleted)
        gate.complete(Unit)
        coroutines.drain()
        assertTrue(opened().isEmpty())
        openKiloDiff(project, "/test", KiloDiffComparison.BASE, "main", parent)
        assertTrue(opened().isEmpty())
    }

    fun `test cancelled service scope prevents delayed and synchronous opening`() {
        val gate = CompletableDeferred<Unit>()
        workspace.beforeBranchName = { gate.await() }
        openKiloDiff(project, "/test", KiloDiffComparison.BASE)
        coroutines.drain()
        coroutines.scope.cancel()
        gate.complete(Unit)
        UIUtil.dispatchAllInvocationEvents()
        openKiloDiff(project, "/test", KiloDiffComparison.LOCAL, "main")
        assertTrue(opened().isEmpty())
    }

    fun `test refresh keeps each comparison and loads fresh contents`() {
        for (comparison in KiloDiffComparison.entries) {
            val files = if (comparison == KiloDiffComparison.BASE) workspace.branchDiffs else workspace.localDiffs
            val params = diffParams(comparison.source, "/test", null, comparison.title("main"), "main")
            val results = mutableListOf<DiffEditorData>()
            val first = file("src/First.kt", 1, 0)
            files.add(first)
            service.refresh(params, results::add)
            coroutines.drain()
            assertEquals(DiffEditorData.Files(listOf(first), "main"), results.last())

            val next = file("src/Next.kt", 2, 1)
            files.clear()
            files.add(next)
            service.refresh(params, results::add)
            coroutines.drain()
            assertEquals(DiffEditorData.Files(listOf(next), "main"), results.last())

            files.clear()
            service.refresh(params, results::add)
            coroutines.drain()
            assertEquals(DiffEditorData.Empty, results.last())
        }
        assertEquals(listOf(true, true, true), workspace.branchDiffPatchCalls)
        assertEquals(listOf(true, true, true), workspace.localDiffPatchCalls)
    }

    fun `test local load and refresh cancel without delivering stale contents`() {
        val gate = CompletableDeferred<Unit>()
        workspace.beforeLocalDiff = { gate.await() }
        workspace.localDiffs.add(file("src/Old.kt", 1, 0))
        val params = diffParams("local", "/test", null, "Local", "main")
        val parent = Disposer.newDisposable(testRootDisposable)
        val results = mutableListOf<DiffEditorData>()
        service.load(params, parent, results::add)
        coroutines.drain()
        assertEquals(listOf("/test"), workspace.localDiffCalls)
        Disposer.dispose(parent)
        val job = service.refresh(params, results::add)
        coroutines.drain()
        job.cancel()
        gate.complete(Unit)
        coroutines.drain()
        assertEquals(listOf(DiffEditorData.Connecting), results)

        workspace.localDiffs.clear()
        val next = file("src/New.kt", 2, 0)
        workspace.localDiffs.add(next)
        service.load(params, Disposer.newDisposable(testRootDisposable), results::add)
        coroutines.drain()
        assertEquals(DiffEditorData.Files(listOf(next), "main"), results.last())
    }

    fun `test comparison failures surface editor errors without changing sources`() {
        workspace.beforeBranchDiff = { error("base unavailable") }
        workspace.beforeLocalDiff = { error("local unavailable") }
        for (comparison in KiloDiffComparison.entries) {
            val results = mutableListOf<DiffEditorData>()
            service.refresh(diffParams(comparison.source, "/test", null, "Changes"), results::add)
            coroutines.drain()
            assertTrue(results.single() is DiffEditorData.Error)
        }
        assertEquals(listOf("/test"), workspace.branchDiffCalls)
        assertEquals(listOf("/test"), workspace.localDiffCalls)
        assertTrue(sides.isEmpty())
    }

    private fun opened() = FileEditorManager.getInstance(project).openFiles.filterIsInstance<KiloVirtualFile>()

    private fun file(path: String, additions: Int, deletions: Int) = DiffFileDto(path, additions, deletions)
}
