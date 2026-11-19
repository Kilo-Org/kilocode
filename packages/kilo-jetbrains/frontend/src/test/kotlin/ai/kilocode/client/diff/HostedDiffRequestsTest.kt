package ai.kilocode.client.diff

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceCache
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileResultDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeRepositoryDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesRefreshDto
import ai.kilocode.rpc.dto.HostedWorkspaceComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceContentAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceDiffAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileContentDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileDiffDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileRecordDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffFileDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffFileResultDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffIdentityDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.DiffRequest
import com.intellij.diff.requests.MessageDiffRequest
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.tools.util.DiffSplitter
import com.intellij.diff.util.DiffUserDataKeys
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.progress.EmptyProgressIndicator
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.components.JBLabel
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.treeStructure.Tree
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container
import java.awt.GraphicsEnvironment
import java.awt.image.BufferedImage
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import javax.imageio.ImageIO
import javax.swing.SwingUtilities
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.TreePath
import javax.swing.tree.TreeCellRenderer

class HostedDiffRequestsTest : BasePlatformTestCase() {
    private val ref = HostedWorkspaceRefDto("cloud", "one")
    private val email = "person@example.com"
    private val source = HostedDiffSource(ref, HostedDiffComparison.COMMITTED, HostedDiffSource.account(email), "org")
    private val repository = HostedWorkspaceChangeRepositoryDto("", "org/repo")
    private val comparison = HostedWorkspaceComparisonDto("main", "a".repeat(40), "b".repeat(40))
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var connection: FakeAppRpcApi
    private lateinit var rpc: Rpc
    private var enabled = true

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        service<HostedWorkspaceCache>().clear()
        Disposer.register(testRootDisposable) { scope.cancel() }
        val state = KiloAppStateDto(KiloAppStatusDto.READY, profile = ProfileDto(email, currentOrgId = source.organization))
        connection = FakeAppRpcApi().also { it.state.value = state }
        app = KiloAppService(scope, connection)
        app._state.value = state
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        rpc = Rpc()
        project.replaceService(KiloHostedService::class.java,
            KiloHostedService(scope, rpc, app = app, gate = { enabled }, log = TestLog()), testRootDisposable)
    }

    fun `test hosted identity has no local or session identity and siblings share canonical params`() {
        val params = source.params()
        assertTrue(KiloDiffEditorKind.isValid(params))
        assertEquals(source, HostedDiffSource.parse(params))
        assertNull(params["directory"])
        assertNull(params["sessionId"])
        assertEquals(source.params(), source.copy(ref = HostedWorkspaceRefDto("cloud", "one")).params())
        assertFalse(KiloDiffEditorKind.isValid(params + ("directory" to "/fake")))
        assertFalse(params == source.copy(comparison = HostedDiffComparison.UNCOMMITTED).params())
        assertFalse(params == source.copy(organization = "other").params())
        service<HostedWorkspaceCache>().putTitle(source.ref, "Task overview")
        assertEquals(params, source.params())
        assertEquals(listOf("PR base", "PR head"), HostedDiffComparison.PULL_REQUEST.labels().toList())
    }

    fun `test hosted routing persists an opaque account key instead of an email`() {
        val params = source.params()
        val path = KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, params))
        assertEquals(64, params["account"]?.length)
        assertFalse(path.path.toString().contains(email))
        assertFalse(path.url.contains(email))
        assertFalse(source.params() == source.copy(account = HostedDiffSource.account("other@example.com")).params())
        assertFalse(KiloDiffEditorKind.isValid(params + ("account" to email)))
        assertTrue(source.current(project))
    }

    fun `test title refresh only updates comparisons that are already open`() {
        val registry = service<KiloEditorKindRegistry>()
        val fs = KiloVirtualFileSystem.getInstance()
        fun path(comparison: HostedDiffComparison) =
            KiloPath(KiloDiffEditorKind.ID, source.copy(comparison = comparison).params())
        try {
            registry.register(KiloDiffEditorKind)
            val cache = service<HostedWorkspaceCache>()
            cache.putTitle(ref, "Task overview")
            refreshHostedDiffTitles(project, ref)
            HostedDiffComparison.entries.forEach { assertNull(fs.cached(path(it))) }

            assertNotNull(fs.findOrCreateFile(path(HostedDiffComparison.COMMITTED)))
            cache.putTitle(ref, "Renamed task")
            refreshHostedDiffTitles(project, ref)
            assertNotNull(fs.cached(path(HostedDiffComparison.COMMITTED)))
            HostedDiffComparison.entries.filter { it != HostedDiffComparison.COMMITTED }.forEach {
                assertNull(fs.cached(path(it)))
            }
        } finally {
            registry.unregister(KiloDiffEditorKind.ID)
            fs.clear()
        }
    }

    fun `test hosted tab names distinguish workspaces and comparisons`() {
        val workspaces = listOf(ref to "Task overview", ref.copy(workspaceID = "two") to "feature/two")
        val cache = service<HostedWorkspaceCache>()
        val titles = workspaces.flatMap { (workspace, label) ->
            cache.putTitle(workspace, label)
            HostedDiffComparison.entries.map { comparison ->
                val params = source.copy(ref = workspace, comparison = comparison).params()
                val title = KiloDiffEditorKind.title(params)
                val expected = when (comparison) {
                    HostedDiffComparison.COMMITTED -> KiloDiffComparison.BASE.title(label)
                    HostedDiffComparison.UNCOMMITTED -> KiloDiffComparison.LOCAL.title(label)
                    HostedDiffComparison.PULL_REQUEST -> KiloBundle.message("diff.editor.hosted.pr.title.named", label)
                }
                assertEquals(expected, title)
                assertFalse(title.contains(workspace.key))
                title
            }
        }
        assertEquals(6, titles.toSet().size)
    }

    fun `test same-named workspaces get distinct titles without changing tab identity`() {
        val cache = service<HostedWorkspaceCache>()
        val sibling = ref.copy(workspaceID = "sibling-workspace")
        cache.putTitle(ref, "Same task")
        cache.putTitle(sibling, "Same task")
        val first = source.copy(comparison = HostedDiffComparison.COMMITTED).params()
        val second = source.copy(ref = sibling, comparison = HostedDiffComparison.COMMITTED).params()
        val firstTitle = KiloDiffEditorKind.title(first)
        val secondTitle = KiloDiffEditorKind.title(second)
        assertTrue(firstTitle != secondTitle)
        assertTrue(firstTitle.contains("Same task"))
        assertTrue(secondTitle.contains("Same task"))
        assertTrue(firstTitle.contains(ref.workspaceID.takeLast(8)))
        assertTrue(secondTitle.contains(sibling.workspaceID.takeLast(8)))
        assertEquals(first, source.copy(comparison = HostedDiffComparison.COMMITTED).params())
    }

    fun `test actual fetch branches before local services and details remain lazy`() {
        rpc.changes = changes(listOf(metadata("src/Raw\\name.kt"), metadata("src/Other.kt")))
        val data = background { project.service<KiloDiffEditorService>().fetch(source.params()) } as DiffEditorData.Files
        val snapshot = data.hosted!!
        assertEquals(2, data.files.size)
        assertEquals(1, rpc.reads)
        assertTrue(rpc.requests.isEmpty())

        val entry = snapshot.entries.first { it.path == "src/Raw\\name.kt" }
        val request = process(snapshot, entry) as SimpleDiffRequest
        assertEquals(listOf(Triple(entry.path, "against-base-branch", 7L)), rpc.requests)
        assertEquals(entry.key, request.getUserData(DIFF_FILE_KEY))
        assertEquals(true, request.getUserData(DiffUserDataKeys.FORCE_READ_ONLY))
        assertEquals(listOf("old", "new"), request.contents.map { (it as DocumentContent).document.text })
        assertEquals(listOf("Base", "HEAD"), request.contentTitles)
        assertTrue(request.contents.filterIsInstance<DocumentContent>().all { it.highlightFile == null })
    }

    fun `test scopes are exact and unspecified scope warns instead of looking clean`() {
        rpc.changes = changes(listOf(metadata("committed.kt"), metadata("local.kt", "uncommitted"), metadata("legacy.kt", null)))
        val committed = background { loadHostedDiff(project, source, false) }.hosted!!
        val local = background { loadHostedDiff(project, source.copy(comparison = HostedDiffComparison.UNCOMMITTED), false) }.hosted!!
        assertEquals(listOf("committed.kt"), committed.entries.map { it.path })
        assertEquals(listOf("local.kt"), local.entries.map { it.path })
        assertTrue(committed.notices.contains(text("scope.unspecified")))
        assertEquals("uncommitted", local.entries.single().scope)
    }

    fun `test file requests use file revision while root revision invalidates the snapshot`() {
        rpc.changes = changes(listOf(metadata("one.kt")), revision = 6).copy(comparisons = listOf(
            HostedWorkspaceChangeComparisonDto(repository, comparison, false, listOf(metadata("one.kt").copy(revision = 5))),
        ))
        val snapshot = background { loadHostedDiff(project, source, false) }.hosted!!
        assertEquals(6L, snapshot.revision)
        assertEquals(5L, snapshot.entries.single().revision)
        assertTrue(process(snapshot) is SimpleDiffRequest)
        assertEquals(listOf(Triple("one.kt", "against-base-branch", 5L)), rpc.requests)
    }

    fun `test explicit hosted refresh uses refresh operation without eager file details`() {
        rpc.changes = changes(listOf(metadata("one.kt")), revision = 8)
        val data = background { loadHostedDiff(project, source, true) }
        assertEquals(1, rpc.refreshes)
        assertEquals(0, rpc.reads)
        assertEquals(8L, data.hosted?.revision)
        assertEquals("refreshed", data.hosted?.refresh)
        assertTrue(rpc.requests.isEmpty())
    }

    fun `test available file retains its own comparison after unrelated root comparison advances`() {
        rpc.changes = changes(listOf(metadata("one.kt")), revision = 8).copy(comparisons = listOf(
            HostedWorkspaceChangeComparisonDto(repository, comparison.copy(head = "d".repeat(40)), false,
                listOf(metadata("one.kt").copy(revision = 5))),
        ))
        val snapshot = background { loadHostedDiff(project, source, false) }.hosted!!
        val request = process(snapshot) as SimpleDiffRequest
        assertEquals(8L, snapshot.revision)
        assertEquals(listOf(Triple("one.kt", "against-base-branch", 5L)), rpc.requests)
        assertEquals(listOf("Base", "HEAD"), request.contentTitles)
        assertEquals(listOf("old", "new"), request.contents.map { (it as DocumentContent).document.text })
    }

    fun `test disabled hosted gate rejects reads and lazy results without relying on EDT invalidation`() {
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))))
        enabled = false
        val data = background { loadHostedDiff(project, source, false) }
        assertTrue(data.files.isEmpty())
        assertEquals(text("unavailable"), (process(snapshot) as MessageDiffRequest).message)
        assertEquals(0, rpc.reads)
        assertTrue(rpc.requests.isEmpty())
    }

    fun `test repository attribution is preserved and ambiguous file queries fail closed`() {
        val one = metadata("same.kt")
        val two = one.copy(repository = HostedWorkspaceChangeRepositoryDto("nested", "other/repo"))
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(one, two)))
        assertTrue(snapshot.entries.isEmpty())
        assertEquals(text("file.ambiguous"), snapshot.message)
        val unique = HostedDiffSnapshot.workspace(source, changes(listOf(one, two.copy(path = "nested/same.kt"))))
        assertEquals(setOf(repository, two.repository), unique.entries.map { it.repository }.toSet())
        assertEquals(2, unique.entries.map { it.key }.distinct().size)
    }

    fun `test clamped projection signals incomplete counts without overflowing aggregate badges`() {
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(
            metadata("one.kt").copy(additions = Int.MAX_VALUE.toLong() + 2, countsComplete = false),
            metadata("two.kt").copy(additions = 10),
        ), truncated = true))
        assertEquals(Int.MAX_VALUE, snapshot.files.first().additions)
        assertTrue(snapshot.notices.contains(text("counts.incomplete")))
        assertTrue(snapshot.notices.contains(text("truncated")))
        val parent = Disposer.newDisposable(testRootDisposable)
        val view = view(snapshot, parent)
        assertTrue(components(view.component).filterIsInstance<DiffStatBadge>().any {
            components(it).filterIsInstance<com.intellij.ui.components.JBLabel>().any { label -> label.text == "+${Int.MAX_VALUE}" }
        })
    }

    fun `test missing and omitted workspace files are explicit keyed messages`() {
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))))
        val entry = snapshot.entries.single()
        for ((status, key) in listOf("stale" to "file.stale", "no_longer_listed" to "file.noLongerListed", "not_captured" to "notCaptured")) {
            rpc.result = HostedWorkspaceChangeFileResultDto(status, null, null, null, 8L.takeUnless { status == "not_captured" })
            val request = process(snapshot, entry) as MessageDiffRequest
            assertEquals(text(key), request.message)
            assertEquals(entry.key, request.getUserData(DIFF_FILE_KEY))
        }
        for (reason in listOf("binary", "unsupported", "invalid_utf8", "too_large", "line_limit", "budget_exhausted", "inconsistent", "capture_failed")) {
            val omitted = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt").copy(
                diff = HostedWorkspaceDiffAvailabilityDto("omitted", reason),
            ))))
            val before = rpc.requests.size
            assertEquals(text("file.omitted.$reason"), (process(omitted) as MessageDiffRequest).message)
            assertEquals(before, rpc.requests.size)
        }
    }

    fun `test captured single content side never becomes fabricated complete sides`() {
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))))
        rpc.patch = "not a unified patch"
        val request = process(snapshot) as MessageDiffRequest
        assertEquals(text("file.omitted.inconsistent"), request.message)
    }

    fun `test lazy result is fenced against changed account organization and invalidated snapshot`() {
        val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))))
        rpc.after = { app._state.value = app.state.value.copy(profile = ProfileDto("other@example.com", currentOrgId = "org")) }
        assertEquals(text("identity.changed"), (process(snapshot) as MessageDiffRequest).message)
        app._state.value = app.state.value.copy(profile = ProfileDto(email, currentOrgId = "other"))
        val count = rpc.requests.size
        assertEquals(text("identity.changed"), (process(snapshot) as MessageDiffRequest).message)
        assertEquals(count, rpc.requests.size)
        app._state.value = app.state.value.copy(profile = ProfileDto(email, currentOrgId = source.organization))
        snapshot.invalidate()
        assertEquals(text("file.stale"), (process(snapshot) as MessageDiffRequest).message)
        assertEquals(count, rpc.requests.size)
    }

    fun `test actual editor load clears hosted presentation on organization change`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            val results = mutableListOf<DiffEditorData>()
            project.service<KiloDiffEditorService>().load(source.params(), parent, results::add)
            assertTrue("Hosted snapshot must finish loading", coroutines.pumpUntil {
                (results.lastOrNull() as? DiffEditorData.Files)?.files?.isNotEmpty() == true
            })
            app._state.value = app.state.value.copy(profile = ProfileDto(email, currentOrgId = "other"))
            assertTrue("Organization changes must clear loaded hosted files", coroutines.pumpUntil {
                val data = results.lastOrNull() as? DiffEditorData.Files
                data?.files?.isEmpty() == true && data.hosted?.message == text("identity.changed")
            })
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test a populated different organization clears the saved diff while loading`() = mismatch(
        KiloAppStatusDto.LOADING, ProfileDto(email, currentOrgId = "other"),
    )

    fun `test a populated different account clears the saved diff while disconnected`() = mismatch(
        KiloAppStatusDto.DISCONNECTED, ProfileDto("other@example.com", currentOrgId = source.organization),
    )

    private fun mismatch(status: KiloAppStatusDto, profile: ProfileDto) {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            val editor = native(root, "new")!!
            val reads = rpc.reads
            val transient = app.state.value.copy(status = status)
            connection.state.value = transient
            assertTrue(coroutines.pumpUntil { app.state.value.status == status })
            coroutines.drain()
            assertNull(source.reason(project))
            assertSame(editor, native(root, "new"))
            app._state.value = transient.copy(profile = profile)
            assertTrue(coroutines.pumpUntil {
                components(root).filterIsInstance<EditorNotificationPanel>().singleOrNull()?.text?.contains(text("identity.changed")) == true &&
                    native(root, "new") == null
            })
            assertEquals(status, app.state.value.status)
            assertEquals(reads, rpc.reads)
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test reconnect states with no profile retain the actual saved editor and block new requests`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            rpc.changes = changes(listOf(metadata("a.kt"), metadata("b.kt")))
            val original = app.state.value
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            val tree = components(root).filterIsInstance<Tree>().single()
            rpc.patch = "@@ -1 +1 @@\n-old\n+selected"
            tree.selectionPath = TreePath(leaves(tree).last().path)
            assertTrue(coroutines.pumpUntil { native(root, "selected") != null })
            val editor = native(root, "selected")!!
            val content = root.components.single()
            val model = tree.model
            val selection = tree.selectionPath
            val reads = rpc.reads
            val requests = rpc.requests.size
            val snapshot = HostedDiffSnapshot.workspace(source, rpc.changes)
            for (state in listOf(
                KiloAppStateDto(KiloAppStatusDto.DISCONNECTED),
                KiloAppStateDto(KiloAppStatusDto.CONNECTING),
                KiloAppStateDto(KiloAppStatusDto.LOADING, progress = LoadProgressDto(profile = ProfileStatusDto.LOADED)),
                KiloAppStateDto(KiloAppStatusDto.ERROR),
            )) {
                connection.state.value = state
                assertTrue(coroutines.pumpUntil { app.state.value.status == state.status })
                coroutines.drain()
                assertFalse(source.current(project))
                assertNull(source.reason(project))
                assertEquals(text("unavailable"), (process(snapshot) as MessageDiffRequest).message)
                refresh(root)
                assertTrue(coroutines.pumpUntil {
                    components(root).filterIsInstance<EditorNotificationPanel>().single().let {
                        it.isVisible && it.text.contains(text("unavailable"))
                    }
                })
                assertSame(content, root.components.single())
                assertSame(model, tree.model)
                assertEquals(selection, tree.selectionPath)
                assertSame(editor, native(root, "selected"))
            }
            assertEquals(reads, rpc.reads)
            assertEquals(requests, rpc.requests.size)
            assertEquals(0, rpc.refreshes)
            connection.state.value = original
            assertTrue(coroutines.pumpUntil { source.current(project) })
            assertSame(content, root.components.single())
            assertSame(editor, native(root, "selected"))
            assertTrue(process(snapshot) is SimpleDiffRequest)
            connection.state.value = KiloAppStateDto(KiloAppStatusDto.LOADING)
            assertTrue(coroutines.pumpUntil { app.state.value.status == KiloAppStatusDto.LOADING })
            connection.state.value = original.copy(profile = ProfileDto("other@example.com", currentOrgId = source.organization))
            assertTrue(coroutines.pumpUntil { native(root, "selected") == null })
            assertTrue(components(root).filterIsInstance<EditorNotificationPanel>().single().text.contains(text("identity.changed")))
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test explicit signout during loading clears with a sign in message`() = invalidation(
        KiloAppStateDto(KiloAppStatusDto.LOADING, progress = LoadProgressDto(profile = ProfileStatusDto.NOT_LOGGED_IN)), "signedOut",
    )

    fun `test ready without a profile clears with a sign in message`() = invalidation(
        KiloAppStateDto(KiloAppStatusDto.READY), "signedOut",
    )

    fun `test disabled gate clears with unavailable instead of identity change`() = invalidation(
        KiloAppStateDto(KiloAppStatusDto.LOADING), "unavailable",
    )

    private fun invalidation(state: KiloAppStateDto, reason: String) {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            enabled = reason != "unavailable"
            connection.state.value = state
            assertTrue(coroutines.pumpUntil {
                components(root).filterIsInstance<EditorNotificationPanel>().singleOrNull()?.text?.contains(text(reason)) == true &&
                    native(root, "new") == null
            })
            assertEquals(text(reason), (process(HostedDiffSnapshot.workspace(source, rpc.changes)) as MessageDiffRequest).message)
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test queued initial manifest and completed patch cannot publish into an unknown context`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            val original = app.state.value
            val snapshot = HostedDiffSnapshot.workspace(source, rpc.changes)
            rpc.after = { app._state.value = KiloAppStateDto(KiloAppStatusDto.LOADING) }
            assertEquals(text("unavailable"), (process(snapshot) as MessageDiffRequest).message)
            rpc.after = {}
            app._state.value = original
            rpc.pause = CompletableDeferred()
            val results = mutableListOf<DiffEditorData>()
            KiloDiffEditorService(project, coroutines.scope).load(source.params(), parent, results::add)
            assertTrue(coroutines.pumpUntil { rpc.reads == 1 })
            rpc.pause!!.complete(Unit)
            coroutines.drain(pump = {})
            app._state.value = KiloAppStateDto(KiloAppStatusDto.CONNECTING)
            assertTrue(coroutines.pumpUntil {
                (results.lastOrNull() as? DiffEditorData.Files)?.hosted?.message == text("unavailable")
            })
            assertTrue(results.filterIsInstance<DiffEditorData.Files>().all { it.files.isEmpty() })
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test queued native patch shows unavailable and automatically reloads the selected file after reconnect`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            rpc.changes = changes(listOf(metadata("a.kt"), metadata("b.kt")))
            val original = app.state.value
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            val tree = components(root).filterIsInstance<Tree>().single()
            rpc.patch = "@@ -1 +1 @@\n-old\n+queued"
            // The blocking producer's coroutine finishes after its final context check.
            rpc.finished = { app._state.value = KiloAppStateDto(KiloAppStatusDto.CONNECTING) }
            tree.selectionPath = TreePath(leaves(tree).last().path)
            assertTrue(coroutines.pumpUntil { app.state.value.status == KiloAppStatusDto.CONNECTING })
            assertTrue(coroutines.pumpUntil {
                components(root).filterIsInstance<JBLabel>().any { it.text?.contains(text("unavailable")) == true }
            })
            assertNull(native(root, "queued"))
            assertNull(native(root, "new"))
            val selection = tree.selectionPath
            val requests = rpc.requests.size
            rpc.finished = null
            app._state.value = original
            assertTrue(coroutines.pumpUntil { native(root, "queued") != null })
            assertEquals(selection, tree.selectionPath)
            assertEquals(requests + 1, rpc.requests.size)
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test refresh completed during reconnect retains the exact saved tree selection and native patch`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            val original = app.state.value
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            val tree = components(root).filterIsInstance<Tree>().single()
            val model = tree.model
            val selection = tree.selectionPath
            val editor = native(root, "new")!!
            rpc.pause = CompletableDeferred()
            refresh(root)
            assertTrue(coroutines.pumpUntil { rpc.refreshes == 1 })
            connection.state.value = KiloAppStateDto(KiloAppStatusDto.LOADING)
            assertTrue(coroutines.pumpUntil { app.state.value.status == KiloAppStatusDto.LOADING })
            rpc.changes = changes(emptyList(), revision = 8)
            rpc.pause!!.complete(Unit)
            assertTrue(coroutines.pumpUntil {
                components(root).filterIsInstance<EditorNotificationPanel>().single().text.contains(text("unavailable"))
            })
            assertSame(model, tree.model)
            assertEquals(selection, tree.selectionPath)
            assertSame(editor, native(root, "new"))
            val failed = background { loadHostedDiff(project, source, true) }
            assertEquals("failed", failed.hosted?.refresh)
            connection.state.value = original
            assertTrue(coroutines.pumpUntil { source.current(project) })
            assertSame(editor, native(root, "new"))
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test selecting an uncached file during reconnect automatically loads it when ready`() = reconnect(false)

    fun `test closing a pending reconnect cancels the automatic file reload`() = reconnect(true)

    fun `test an unknown context result still requires recovery if ready returns before publication`() {
        val original = app.state.value
        val snapshot = HostedDiffSnapshot.workspace(source, rpc.changes)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
        val request = process(snapshot) as MessageDiffRequest
        assertEquals(text("unavailable"), request.message)
        assertTrue(rpc.requests.isEmpty())
        app._state.value = original
        assertTrue(source.current(project))
        assertEquals(true, request.getUserData(HOSTED_RETRY_KEY))
        assertTrue(process(snapshot) is SimpleDiffRequest)
        assertEquals(1, rpc.requests.size)
        val omitted = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("binary.kt").copy(
            diff = HostedWorkspaceDiffAvailabilityDto("omitted", "binary"),
        ))))
        assertNull(process(omitted).getUserData(HOSTED_RETRY_KEY))
    }

    private fun reconnect(close: Boolean) {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            rpc.changes = changes(listOf(metadata("a.kt"), metadata("b.kt")))
            val original = app.state.value
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue(coroutines.pumpUntil { native(root, "new") != null })
            val tree = components(root).filterIsInstance<Tree>().single()
            val requests = rpc.requests.size
            app._state.value = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
            tree.selectionPath = TreePath(leaves(tree).last().path)
            assertTrue(coroutines.pumpUntil {
                components(root).filterIsInstance<JBLabel>().any { it.text?.contains(text("unavailable")) == true }
            })
            assertNull(native(root, "new"))
            assertEquals(requests, rpc.requests.size)
            val selection = tree.selectionPath
            rpc.patch = "@@ -1 +1 @@\n-old\n+selected"
            if (close) Disposer.dispose(parent)
            app._state.value = original
            if (close) {
                coroutines.drain()
                assertEquals(requests, rpc.requests.size)
                return
            }
            assertTrue(coroutines.pumpUntil { native(root, "selected") != null })
            assertEquals(selection, tree.selectionPath)
            assertEquals(requests + 1, rpc.requests.size)
            assertEquals("b.kt", rpc.requests.last().first)
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test actual hosted editor clears every identity cycle after refreshing restored source`() {
        cycle(KiloAppStatusDto.READY)
    }

    fun `test initial hosted result is fenced again when delivered on EDT`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            rpc.pause = CompletableDeferred()
            val results = mutableListOf<DiffEditorData>()
            val service = KiloDiffEditorService(project, coroutines.scope)
            service.load(source.params(), parent, results::add)
            assertTrue("Manifest read must reach the controlled boundary", coroutines.pumpUntil { rpc.reads == 1 })
            rpc.pause!!.complete(Unit)
            // Complete background validation without dispatching its queued EDT publication.
            coroutines.drain(pump = {})
            assertTrue(results.none { it is DiffEditorData.Files })
            app._state.value = app.state.value.copy(profile = ProfileDto(email, currentOrgId = "other"))
            assertTrue("Queued results must be cleared before publication", coroutines.pumpUntil {
                (results.lastOrNull() as? DiffEditorData.Files)?.hosted?.message == text("identity.changed")
            })
            assertTrue("No foreign-context filename may reach the view", results.filterIsInstance<DiffEditorData.Files>().all {
                it.files.isEmpty()
            })
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test initial app error retains identity observation after recovery and refresh`() {
        cycle(KiloAppStatusDto.ERROR)
    }

    fun `test PR loader verifies head lazily maps removed and displays rename origin`() {
        val source = source.copy(comparison = HostedDiffComparison.PULL_REQUEST)
        rpc.pull = pull(listOf(
            HostedWorkspacePullRequestDiffFileDto("deleted.kt", null, "removed", 0, 1, true),
            HostedWorkspacePullRequestDiffFileDto("renamed.kt", "old.kt", "renamed", 1, 1, true),
        ))
        val snapshot = background { loadHostedDiff(project, source, false) }.hosted!!
        assertEquals("deleted", snapshot.files.first().status)
        assertEquals("old.kt", snapshot.entries.last().previous)
        assertTrue(rpc.patches.isEmpty())
        val request = process(snapshot, snapshot.entries.last()) as SimpleDiffRequest
        assertEquals(listOf("renamed.kt" to "c".repeat(40)), rpc.patches)
        assertEquals(listOf("PR base", "PR head"), request.contentTitles)
        rpc.prStatus = "stale"
        assertEquals(text("pr.stale"), (process(snapshot) as MessageDiffRequest).message)
    }

    fun `test PR absence and provider omissions never fabricate an empty successful diff`() {
        val source = source.copy(comparison = HostedDiffComparison.PULL_REQUEST)
        for ((status, key) in listOf("not_linked" to "pr.notLinked", "unverified" to "pr.unverified",
            "credential_required" to "pr.credentials", "unavailable" to "pr.unavailable", "not_github" to "pr.notGithub")) {
            val snapshot = HostedDiffSnapshot.pullRequest(source, HostedWorkspacePullRequestDiffDto(ref, status, null, null, false, emptyList()))
            assertTrue(snapshot.files.isEmpty())
            assertEquals(text(key), snapshot.message)
        }
        val snapshot = HostedDiffSnapshot.pullRequest(source, pull(listOf(HostedWorkspacePullRequestDiffFileDto("binary", null, "modified", 0, 0, false))))
        val request = process(snapshot) as MessageDiffRequest
        assertEquals(text("file.omitted.provider_omitted"), request.message)
        assertEquals(snapshot.entries.single().key, request.getUserData(DIFF_FILE_KEY))
        assertTrue(rpc.patches.isEmpty())
    }

    fun `test refresh keeps selected identity then deterministically falls back and invalidates unchanged stats`() {
        val first = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("b.kt"), metadata("a.kt"))))
        val parent = Disposer.newDisposable(testRootDisposable)
        val view = view(first, parent)
        val tree = components(view.component).filterIsInstance<Tree>().single()
        tree.selectionPath = TreePath(leaves(tree).last().path)
        assertEquals("b.kt", name(tree, tree.lastSelectedPathComponent as DefaultMutableTreeNode))
        val next = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("a.kt"), metadata("b.kt")), revision = 8))
        view.applyFiles(next.files, nextHosted = next)
        assertEquals("b.kt", name(tree, tree.lastSelectedPathComponent as DefaultMutableTreeNode))
        assertEquals(text("file.stale"), (process(first) as MessageDiffRequest).message)
        val final = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("c.kt")), revision = 9))
        view.applyFiles(final.files, nextHosted = final)
        assertEquals("c.kt", name(tree, tree.lastSelectedPathComponent as DefaultMutableTreeNode))
    }

    fun `test new PR head invalidates cached producer even with identical tree metadata`() {
        val source = source.copy(comparison = HostedDiffComparison.PULL_REQUEST)
        val dto = pull(listOf(HostedWorkspacePullRequestDiffFileDto("one.kt", null, "modified", 1, 1, true)))
        val first = HostedDiffSnapshot.pullRequest(source, dto)
        val parent = Disposer.newDisposable(testRootDisposable)
        val view = view(first, parent)
        val next = HostedDiffSnapshot.pullRequest(source, dto.copy(pullRequest = dto.pullRequest!!.copy(headSha = "d".repeat(40))))
        assertEquals(first.files, next.files)
        view.applyFiles(next.files, nextHosted = next)
        assertEquals(text("pr.stale"), (process(first) as MessageDiffRequest).message)
        assertTrue(process(next) is SimpleDiffRequest)
        assertEquals("d".repeat(40), rpc.patches.last().second)
    }

    fun `test unavailable PR refresh preserves actual native tree selection and loaded patch`() {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        val source = source.copy(comparison = HostedDiffComparison.PULL_REQUEST)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            rpc.pull = pull(listOf("a.kt", "b.kt").map { HostedWorkspacePullRequestDiffFileDto(it, null, "modified", 1, 1, true) })
            rpc.prPatch = { path -> "@@ -1 +1 @@\n-before-$path\n+after-$path" }
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            assertTrue("Initial PR patch must finish loading", coroutines.pumpUntil { native(root, "after-a.kt") != null })
            val tree = components(root).filterIsInstance<Tree>().single()
            tree.selectionPath = TreePath(leaves(tree).last().path)
            assertTrue("Selected PR patch must finish loading", coroutines.pumpUntil { native(root, "after-b.kt") != null })
            val editor = native(root, "after-b.kt")!!
            val model = tree.model
            val selection = tree.selectionPath
            rpc.pull = HostedWorkspacePullRequestDiffDto(ref, "unavailable", null, null, false, emptyList())
            refresh(root)
            assertTrue("Unavailable refresh must show an inline warning", coroutines.pumpUntil {
                components(root).filterIsInstance<EditorNotificationPanel>().single().text.contains(text("refresh.failed"))
            })
            assertSame(model, tree.model)
            assertEquals(selection, tree.selectionPath)
            assertSame(editor, native(root, "after-b.kt"))
            assertFalse(editor.isDisposed)
            assertEquals("after-b.kt", editor.document.text)
            val passive = background { loadHostedDiff(project, source, false) }.hosted!!
            assertNull(passive.refresh)
            assertEquals(text("pr.unavailable"), passive.message)
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    fun `test authoritative PR absence verification and authorization statuses clear saved content on refresh`() {
        val coroutines = TestCoroutines()
        val source = source.copy(comparison = HostedDiffComparison.PULL_REQUEST)
        try {
            val service = KiloDiffEditorService(project, coroutines.scope)
            for ((status, key) in listOf("not_linked" to "pr.notLinked", "unverified" to "pr.unverified",
                "credential_required" to "pr.credentials", "not_github" to "pr.notGithub")) {
                val parent = Disposer.newDisposable(testRootDisposable)
                val snapshot = HostedDiffSnapshot.pullRequest(source, pull(listOf(
                    HostedWorkspacePullRequestDiffFileDto("one.kt", null, "modified", 1, 1, true),
                )))
                val view = view(snapshot, parent) { done -> service.refresh(source.params(), done) }
                val tree = components(view.component).filterIsInstance<Tree>().single()
                val model = tree.model
                rpc.pull = HostedWorkspacePullRequestDiffDto(ref, status, null, null, false, emptyList())
                view.refresh()
                assertTrue("$status must clear saved PR content", coroutines.pumpUntil {
                    tree.model !== model && components(view.component).filterIsInstance<EditorNotificationPanel>().single().text.contains(text(key))
                })
                val data = background { loadHostedDiff(project, source, true) }.hosted!!
                assertNull(data.refresh)
                assertTrue(data.files.isEmpty())
                assertEquals(text("pr.stale"), (process(snapshot) as MessageDiffRequest).message)
                Disposer.dispose(parent)
            }
        } finally {
            coroutines.close()
        }
    }

    fun `test failed offline and thrown refresh keep last good tree selection and content producers`() {
        for (status in listOf("failed", "offline", "exception")) {
            val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("a.kt"), metadata("b.kt"))))
            val parent = Disposer.newDisposable(testRootDisposable)
            val view = view(snapshot, parent) { done ->
                done(if (status == "exception") DiffEditorData.Error("offline") else
                    HostedDiffSnapshot.workspace(source, changes(emptyList()), status).data())
                Job().also { it.complete() }
            }
            val tree = components(view.component).filterIsInstance<Tree>().single()
            tree.selectionPath = TreePath(leaves(tree).last().path)
            val model = tree.model
            val selection = tree.selectionPath
            view.refresh()
            assertSame(model, tree.model)
            assertEquals(selection, tree.selectionPath)
            val banner = components(view.component).filterIsInstance<EditorNotificationPanel>().single()
            assertTrue(banner.isVisible)
            assertTrue(banner.text.contains(text(if (status == "offline") "offline" else "refresh.failed")))
            assertTrue(process(snapshot) is SimpleDiffRequest)
            Disposer.dispose(parent)
        }
    }

    fun `test hosted refresh cannot fall back to local or different hosted source data`() {
        for (foreign in listOf(
            DiffEditorData.Files(emptyList()),
            HostedDiffSnapshot(source.copy(ref = HostedWorkspaceRefDto("cloud", "other"))).data(),
        )) {
            val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))))
            val parent = Disposer.newDisposable(testRootDisposable)
            val view = view(snapshot, parent) { done ->
                done(foreign)
                Job().also { it.complete() }
            }
            val tree = components(view.component).filterIsInstance<Tree>().single()
            val model = tree.model
            view.refresh()
            assertSame(model, tree.model)
            assertTrue(components(view.component).filterIsInstance<EditorNotificationPanel>().single().text.contains(text("refresh.failed")))
            assertTrue(process(snapshot) is SimpleDiffRequest)
            Disposer.dispose(parent)
        }
    }

    fun `test offline refresh can recover a saved snapshot after an initial unavailable read`() {
        val initial = HostedDiffSnapshot(source, message = text("unavailable"))
        val next = HostedDiffSnapshot.workspace(source, changes(listOf(metadata("one.kt"))), "offline")
        val parent = Disposer.newDisposable(testRootDisposable)
        val view = view(initial, parent) { done ->
            done(next.data())
            Job().also { it.complete() }
        }
        view.refresh()
        val tree = components(view.component).filterIsInstance<Tree>().single()
        assertEquals("one.kt", name(tree, leaves(tree).single()))
        assertTrue(components(view.component).filterIsInstance<EditorNotificationPanel>().single().text.contains(text("offline")))
        assertTrue(process(next) is SimpleDiffRequest)
    }

    fun `test hosted empty noncaptured and errors retain refresh and never save or listen to local documents`() {
        val psi = myFixture.addFileToProject("local.kt", "old")
        val manager = FileDocumentManager.getInstance()
        val document = manager.getDocument(psi.virtualFile)!!
        val snapshot = HostedDiffSnapshot.workspace(source, HostedWorkspaceChangesDto(ref, "not_captured", null, null, false, null))
        val parent = Disposer.newDisposable(testRootDisposable)
        val view = view(snapshot, parent) { done ->
            done(snapshot.data())
            Job().also { it.complete() }
        }
        val tree = components(view.component).filterIsInstance<Tree>().single()
        assertTrue(ActionUtil.getActions(tree).none { it.templatePresentation.text == KiloBundle.message("diff.editor.openFile") })
        ApplicationManager.getApplication().runWriteAction { document.setText("unsaved") }
        view.refresh()
        assertTrue(manager.isDocumentUnsaved(document))
        assertEquals("unsaved", document.text)
        assertTrue(components(view.component).filterIsInstance<EditorNotificationPanel>().single().isVisible)
    }

    fun `test capture actual hosted native editor fixture when requested`() {
        val path = System.getenv("KILO_TEST_SCREENSHOT") ?: return
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            IconLoader.activate()
            rpc.patch = "@@ -1 +1,2 @@\n-fun status() = \"local\"\n+// Saved Cloud workspace\n+fun status() = \"hosted\""
            val snapshot = HostedDiffSnapshot.workspace(source, changes(listOf(
                metadata("src/main/kotlin/Workspace.kt").copy(additions = 2),
                metadata("src/test/kotlin/WorkerTest.kt").copy(diff = HostedWorkspaceDiffAvailabilityDto("omitted", "binary")),
            )))
            val view = view(snapshot, parent)
            assertTrue("The actual native diff request must be installed before capture", coroutines.pumpUntil {
                EditorFactory.getInstance().allEditors.any {
                    SwingUtilities.isDescendingFrom(it.component, view.component) && it.document.text.contains("fun status() = \"hosted\"") &&
                        it.markupModel.allHighlighters.isNotEmpty()
                }
            })
            fun layout(component: Component) {
                if (component is Container) {
                    component.doLayout()
                    component.components.forEach(::layout)
                }
            }
            // Without a realized peer, CellRendererPane.validate() cannot lay out a JPanel stamp.
            // Delegate to the actual renderer and perform the layout a showing tree would perform.
            components(view.component).filterIsInstance<Tree>().forEach { tree ->
                val renderer = tree.cellRenderer
                tree.cellRenderer = TreeCellRenderer { node, value, selected, expanded, leaf, row, focus ->
                    renderer.getTreeCellRendererComponent(node, value, selected, expanded, leaf, row, focus).also {
                        it.size = it.preferredSize
                        layout(it)
                    }
                }
            }
            view.component.setSize(1280, 800)
            layout(view.component)
            // Native connector painting requires screen coordinates. The headless fixture captures
            // the real editors and tree, excluding only that onscreen-only overlay.
            components(view.component).filterIsInstance<DiffSplitter>().forEach { it.setPainter(null) }
            val image = BufferedImage(1280, 800, BufferedImage.TYPE_INT_ARGB)
            val graphics = image.createGraphics()
            try {
                view.component.paint(graphics)
            } finally {
                graphics.dispose()
            }
            assertTrue(ImageIO.write(image, "png", File(path)))
        } finally {
            Disposer.dispose(parent)
            if (GraphicsEnvironment.isHeadless()) IconLoader.deactivate()
            coroutines.close()
        }
    }

    private fun view(snapshot: HostedDiffSnapshot, parent: Disposable, load: ((DiffEditorData) -> Unit) -> Job = { Job().also { it.complete() } }): DiffEditorView =
        DiffEditorView(project, snapshot.source.params(), snapshot.files, parent, null, scope, load, snapshot) { fail("Hosted data must retain its editor") }

    private fun process(snapshot: HostedDiffSnapshot, entry: HostedDiffEntry = snapshot.entries.first()): DiffRequest =
        background { snapshot.producer(project, entry).process(UserDataHolderBase(), EmptyProgressIndicator()) }

    private fun <T> background(action: suspend () -> T): T = runBlocking(Dispatchers.Default) { action() }

    private fun cycle(status: KiloAppStatusDto) {
        val coroutines = TestCoroutines()
        val parent = Disposer.newDisposable(testRootDisposable)
        try {
            project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
            val original = app.state.value
            val initial = if (status == KiloAppStatusDto.READY) original else KiloAppStateDto(status)
            connection.state.value = initial
            app._state.value = initial
            val root = KiloDiffEditorKind.createContent(project, KiloVirtualFile(KiloPath(KiloDiffEditorKind.ID, source.params())), parent)
            if (status == KiloAppStatusDto.ERROR) {
                assertTrue("Initial application error must retain refresh UI", coroutines.pumpUntil {
                    components(root).filterIsInstance<EditorNotificationPanel>().singleOrNull()?.text?.contains(text("unavailable")) == true
                })
                connection.state.value = original
                assertTrue(coroutines.pumpUntil { app.state.value.status == KiloAppStatusDto.READY })
                refresh(root)
            }
            assertTrue("Saved patch must finish loading", coroutines.pumpUntil { native(root, "new") != null })
            for (round in 1..2) {
                connection.state.value = original.copy(status = KiloAppStatusDto.READY,
                    profile = ProfileDto(email, currentOrgId = "other", name = "other-$round"))
                assertTrue("Every identity change must clear active and cached content", coroutines.pumpUntil {
                    components(root).filterIsInstance<EditorNotificationPanel>().singleOrNull()?.text?.contains(text("identity.changed")) == true &&
                        native(root, "new") == null
                })
                val cleared = root.components.single()
                connection.state.value = connection.state.value.copy(profile = connection.state.value.profile!!.copy(name = "unrelated-$round"))
                assertTrue(coroutines.pumpUntil { app.state.value.profile?.name == "unrelated-$round" })
                coroutines.drain()
                assertSame("Unrelated invalid-source updates must not rerender", cleared, root.components.single())
                if (round == 1) {
                    connection.state.value = original.copy(status = KiloAppStatusDto.READY)
                    assertTrue(coroutines.pumpUntil { source.current(project) })
                    assertSame("Restoring identity waits for explicit refresh", cleared, root.components.single())
                    refresh(root)
                    assertTrue("Refresh must repopulate restored source", coroutines.pumpUntil { native(root, "new") != null })
                }
            }
            Disposer.dispose(parent)
            val cleared = root.components.single()
            connection.state.value = original.copy(status = KiloAppStatusDto.READY)
            assertTrue(coroutines.pumpUntil { source.current(project) })
            connection.state.value = original.copy(profile = ProfileDto(email, currentOrgId = "other"))
            assertTrue(coroutines.pumpUntil { !source.current(project) })
            coroutines.drain()
            assertSame("Disposed editors must not receive identity renders", cleared, root.components.single())
        } finally {
            Disposer.dispose(parent)
            coroutines.close()
        }
    }

    private fun native(root: Component, text: String) = EditorFactory.getInstance().allEditors.firstOrNull {
        SwingUtilities.isDescendingFrom(it.component, root) && it.document.text == text
    }

    private fun refresh(root: Component) {
        val banner = components(root).filterIsInstance<EditorNotificationPanel>().single()
        components(banner).filterIsInstance<HyperlinkLabel>().single().doClick()
    }
    private fun text(key: String): String = KiloBundle.message("diff.editor.hosted.$key")
    private fun metadata(path: String, scope: String? = "against-base-branch") = HostedWorkspaceChangeFileDto(
        path, "modified", 1, 1, true, false, true, 7, repository,
        HostedWorkspaceDiffAvailabilityDto("available"), HostedWorkspaceContentAvailabilityDto("available", "current"), scope,
    )

    private fun changes(files: List<HostedWorkspaceChangeFileDto>, revision: Long = 7, truncated: Boolean = false) = HostedWorkspaceChangesDto(
        ref, "captured", revision, "2026-11-17T12:00:00Z", truncated,
        listOf(HostedWorkspaceChangeComparisonDto(repository, comparison, false, files.map { it.copy(revision = revision) })),
    )

    private fun pull(files: List<HostedWorkspacePullRequestDiffFileDto>) = HostedWorkspacePullRequestDiffDto(ref, "linked", null,
        HostedWorkspacePullRequestDiffIdentityDto(1, "https://github.com/org/repo/pull/1", "open", false, "c".repeat(40), "main", repository, false), false, files)

    private fun components(root: Component): List<Component> = listOf(root) +
        (root as? Container)?.components.orEmpty().flatMap(::components)

    private fun leaves(tree: Tree): List<DefaultMutableTreeNode> = (tree.model.root as DefaultMutableTreeNode)
        .depthFirstEnumeration().asSequence().filterIsInstance<DefaultMutableTreeNode>().filter { it.isLeaf }.toList()

    private fun name(tree: Tree, node: DefaultMutableTreeNode): String = components(tree.cellRenderer.getTreeCellRendererComponent(
        tree, node, false, false, true, 0, false,
    )).filterIsInstance<SimpleColoredComponent>().single().iterator().let { it.next(); it.fragment }

    private inner class Rpc : KiloHostedRpcApi {
        var changes = changes(listOf(metadata("one.kt")))
        var pull = pull(emptyList())
        var result: HostedWorkspaceChangeFileResultDto? = null
        var patch = "@@ -1 +1 @@\n-old\n+new"
        var prStatus = "available"
        var prPatch: (String) -> String = { patch }
        var after: () -> Unit = {}
        var finished: (() -> Unit)? = null
        var reads = 0
        var pause: CompletableDeferred<Unit>? = null
        var refreshes = 0
        val requests = CopyOnWriteArrayList<Triple<String, String?, Long>>()
        val patches = CopyOnWriteArrayList<Pair<String, String>>()

        override suspend fun workspaceChanges(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceChangesDto {
            assertFalse(SwingUtilities.isEventDispatchThread())
            assertEquals(source.organization, organizationID)
            reads += 1
            pause?.await()
            return changes
        }

        override suspend fun refreshWorkspaceChanges(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceChangesRefreshDto {
            assertFalse(SwingUtilities.isEventDispatchThread())
            refreshes += 1
            pause?.await()
            return HostedWorkspaceChangesRefreshDto("refreshed", changes)
        }

        override suspend fun workspaceChangeFile(ref: HostedWorkspaceRefDto, path: String, scope: String?, expectedRevision: Long, organizationID: String?): HostedWorkspaceChangeFileResultDto {
            assertFalse(SwingUtilities.isEventDispatchThread())
            requests.add(Triple(path, scope, expectedRevision))
            finished?.let { callback -> currentCoroutineContext().job.invokeOnCompletion { callback() } }
            after()
            return result ?: HostedWorkspaceChangeFileResultDto("available", HostedWorkspaceFileRecordDto(1, expectedRevision, path,
                HostedWorkspaceFileDiffDto("available", patch), HostedWorkspaceFileContentDto("available", "current", "DO NOT DISPLAY AS FULL CONTENT"), scope),
                "2026-11-17T12:00:00Z", comparison, null)
        }

        override suspend fun workspacePullRequestDiff(ref: HostedWorkspaceRefDto, organizationID: String?) = pull
        override suspend fun workspacePullRequestDiffFile(ref: HostedWorkspaceRefDto, path: String, expectedHeadSha: String, organizationID: String?): HostedWorkspacePullRequestDiffFileResultDto {
            assertFalse(SwingUtilities.isEventDispatchThread())
            patches.add(path to expectedHeadSha)
            return HostedWorkspacePullRequestDiffFileResultDto(prStatus, path, null, null, expectedHeadSha, prPatch(path).takeIf { prStatus == "available" })
        }

        override suspend fun providers(): Nothing = error("Unexpected local fallback")
        override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): Nothing = error("Unexpected discovery")
        override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): Nothing = error("Unexpected session lookup")
        override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("Unexpected compute lookup")
        override suspend fun workspacePullRequest(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("Unexpected PR badge lookup")
        override suspend fun refreshWorkspacePullRequest(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("Unexpected PR mutation")
        override suspend fun workspaceProfiles(organizationID: String?): Nothing = error("Unexpected profiles")
        override suspend fun setPersonalDefaultProfile(profileID: String): Nothing = error("Unexpected profile write")
        override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): Nothing = error("Unexpected create")
        override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: HostedStartSessionDto): Nothing = error("Unexpected session start")
        override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?): Nothing = error("Unexpected delete")
        override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Nothing = error("Unexpected events")
    }
}
