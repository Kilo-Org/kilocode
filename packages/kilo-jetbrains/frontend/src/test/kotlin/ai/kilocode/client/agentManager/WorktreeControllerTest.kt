package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.CreateFailure
import ai.kilocode.client.agentManager.worktree.CreateKind
import ai.kilocode.client.agentManager.worktree.KiloRunService
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.PendingPrompt
import ai.kilocode.client.agentManager.worktree.PendingWorktreePrompt
import ai.kilocode.client.agentManager.worktree.PendingWorktreeSession
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeNames
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.testing.FakeRunRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.tree.ActiveTree
import ai.kilocode.client.ui.tree.ActiveTreeNode
import ai.kilocode.client.ui.tree.ActiveTreeView
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.MoveStage
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.util.IconLoader
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import java.awt.GraphicsEnvironment
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

@Suppress("UnstableApiUsage")
class WorktreeControllerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var run: FakeRunRpcApi
    private lateinit var service: KiloWorktreeService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        run = FakeRunRpcApi()
        service = KiloWorktreeService(coroutines.scope, rpc)
        ApplicationManager.getApplication()
            .replaceService(KiloRunService::class.java, KiloRunService(coroutines.scope, run), testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(PendingWorktreePrompt::class.java, PendingWorktreePrompt(), testRootDisposable)
    }

    override fun tearDown() {
        try {
            cache().clear()
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test reload lists only non-main worktrees`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertEquals("/repo", controller.current?.path)
    }

    fun `test branch tracker reloads a checkout switched outside the list`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val feature = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += main
        rpc.listed += feature
        val controller = controller()
        controller.reload()
        flush()
        val changes = mutableListOf<Set<String>>()
        controller.onBranchChanged = { changes += it }
        rpc.listCalls.clear()

        rpc.listed[0] = main.copy(branch = "feature/y")
        rpc.listed[1] = feature.copy(branch = "feature/z")
        controller.refreshBranches()
        flush()

        assertEquals("feature/y", controller.current?.branch)
        assertEquals("feature/z", controller.model.getElementAt(0).branch)
        assertEquals(listOf(setOf("/repo", "/repo/.kilo/worktrees/feature-x")), changes)
        assertEquals(listOf("/test"), rpc.listCalls.toList())
    }

    fun `test reload announces changed branches but not initial or unchanged listings`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val feature = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += listOf(main, feature)
        val controller = controller()
        val changes = mutableListOf<Set<String>>()
        controller.onBranchChanged = { changes += it }
        controller.reload()
        flush()
        assertTrue(changes.isEmpty())

        rpc.listed[0] = main.copy(branch = "feature/y")
        rpc.listed[1] = feature.copy(branch = "feature/z")
        controller.reload()
        flush()

        assertEquals(listOf(setOf("/repo", feature.path)), changes)
        assertEquals("feature/y", controller.current?.branch)
        assertEquals("feature/z", controller.model.getElementAt(0).branch)

        controller.reload()
        flush()
        assertEquals(1, changes.size)
    }

    fun `test branch tracker ignores a listing superseded by a newer reload`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += main
        val controller = controller()
        controller.reload()
        flush()
        val changes = mutableListOf<Set<String>>()
        controller.onBranchChanged = { changes += it }
        var reloads = 0
        controller.onReload = { reloads++ }
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeList = {
            entered.complete(Unit)
            gate.await()
        }

        controller.refreshBranches()
        assertTrue(coroutines.pumpUntil { entered.isCompleted })
        rpc.beforeList = {}
        rpc.listed[0] = main.copy(branch = "feature/y")
        controller.reload()
        flush()
        assertEquals("feature/y", controller.current?.branch)
        assertEquals("the winning reload must invalidate the old branch's badge", listOf(setOf("/repo")), changes)

        gate.complete(Unit)
        flush()

        assertEquals("feature/y", controller.current?.branch)
        assertEquals("the stale poll must not invalidate the newer branch's badge again", listOf(setOf("/repo")), changes)
        assertEquals(1, reloads)
        assertEquals(3, rpc.listCalls.size)
    }

    fun `test a superseded reload does not announce its discarded branch change`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += main
        val controller = controller()
        controller.reload()
        flush()
        val changes = mutableListOf<Set<String>>()
        controller.onBranchChanged = { changes += it }
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeList = {
            entered.complete(Unit)
            gate.await()
        }

        rpc.listed[0] = main.copy(branch = "feature/y")
        controller.reload()
        assertTrue(coroutines.pumpUntil { entered.isCompleted })
        rpc.beforeList = {}
        rpc.listed[0] = main
        controller.reload()
        flush()

        gate.complete(Unit)
        flush()

        assertEquals("main", controller.current?.branch)
        assertTrue("a discarded reload must not invalidate PR state", changes.isEmpty())
    }

    fun `test branch tracker leaves unchanged rows and selection alone`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()
        controller.reload()
        flush()
        val before = controller.model.getElementAt(0)
        var reloads = 0
        val changes = mutableSetOf<String>()
        controller.onReload = { reloads++ }
        controller.onBranchChanged = { changes += it }

        controller.refreshBranches()
        flush()

        assertSame(before, controller.model.getElementAt(0))
        assertEquals(0, reloads)
        assertTrue(changes.isEmpty())
    }

    fun `test branch tracker keeps the previous rows when the listing comes back empty`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()
        controller.reload()
        flush()

        rpc.listed.clear()
        controller.refreshBranches()
        flush()

        assertEquals("main", controller.current?.branch)
        assertEquals(1, controller.model.size)
    }

    fun `test service open routes the directory to the backend rpc`() {
        var result: Boolean? = null
        coroutines.scope.launch { result = service.open("/repo/.kilo/worktrees/feature-x") }
        flush()

        assertEquals(true, result)
        assertEquals(listOf("/repo/.kilo/worktrees/feature-x"), rpc.opens.toList())
    }

    fun `test service open returns false when the backend call fails`() {
        rpc.openResult = { error("boom") }
        var result: Boolean? = null
        coroutines.scope.launch { result = service.open("/repo/x") }
        flush()

        assertEquals(false, result)
    }

    fun `test create invokes rpc and adds the created worktree`() {
        val controller = controller()
        val selected = mutableListOf<String>()
        controller.onSelect = { selected.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }

        assertEquals(1, controller.model.size)
        assertTrue(controller.isPending(controller.model.getElementAt(0).id))
        assertEquals(controller.model.getElementAt(0).id, selected.single())
        flush()

        assertEquals(listOf("feature/y"), rpc.creates.map { it.branch })
        assertEquals(1, controller.model.size)
        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertFalse(controller.isPending(controller.model.getElementAt(0).id))
        assertEquals("feature/y", selected.last())
    }

    fun `test create prepends placeholder and created worktree`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }

        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertTrue(controller.isPending(controller.model.getElementAt(0).id))
        gate.complete(Unit)
        flush()

        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertFalse(controller.isPending(controller.model.getElementAt(0).id))
    }

    fun `test create and imports place IDs on EDT before adding or replacing rows`() {
        for (kind in CreateKind.entries) {
            for (retained in listOf(true, false)) {
                val gate = CompletableDeferred<Unit>()
                rpc.beforeCreate = { gate.await() }
                val controller = controller()
                val events = mutableListOf<Pair<String, String>>()
                val placed = mutableListOf<Pair<String, String?>>()
                controller.model.addListDataListener(object : ListDataListener {
                    override fun contentsChanged(event: ListDataEvent) {
                        assertTrue(ApplicationManager.getApplication().isDispatchThread)
                        events += "row" to controller.model.getElementAt(event.index0).id
                    }

                    override fun intervalAdded(event: ListDataEvent) = contentsChanged(event)
                    override fun intervalRemoved(event: ListDataEvent) = Unit
                })
                val place: (String, String?) -> Unit = { id, previous ->
                    assertTrue(ApplicationManager.getApplication().isDispatchThread)
                    assertFalse((0 until controller.model.size).any { controller.model.getElementAt(it).id == id })
                    placed += id to previous
                    events += "place" to id
                }

                ApplicationManager.getApplication().invokeAndWait {
                    when (kind) {
                        CreateKind.CREATE -> controller.create("feature/y", null, place = place)
                        CreateKind.BRANCH -> controller.importBranch("feature/x", place = place)
                        CreateKind.PR -> controller.importPr("https://github.com/o/r/pull/7", place = place)
                    }
                }
                val temp = controller.model.getElementAt(0)
                assertTrue(controller.isPending(temp.id))
                assertEquals(listOf(temp.id to null), placed)
                assertEquals(listOf("place" to temp.id, "row" to temp.id), events)
                if (!retained) {
                    ApplicationManager.getApplication().invokeAndWait { controller.model.remove(temp) }
                }

                gate.complete(Unit)
                flush()

                val created = controller.model.getElementAt(0)
                assertFalse(controller.isPending(created.id))
                assertEquals(listOf(temp.id to null, created.id to temp.id), placed)
                assertEquals(
                    listOf("place" to temp.id, "row" to temp.id, "place" to created.id, "row" to created.id),
                    events,
                )
            }
        }
    }

    fun `test overlapping requests keep their placement callbacks when completed out of order`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = controller()
        val first = mutableListOf<Pair<String, String?>>()
        val second = mutableListOf<Pair<String, String?>>()

        ApplicationManager.getApplication().invokeAndWait {
            controller.create("feature/y", null, place = { id, previous -> first += id to previous })
        }
        val temp = first.single().first
        flush()
        assertEquals(1, rpc.creates.size)
        val finish = CompletableDeferred<Unit>()
        rpc.beforeCreate = { finish.await() }

        ApplicationManager.getApplication().invokeAndWait {
            controller.importPr("https://github.com/o/r/pull/7", place = { id, previous -> second += id to previous })
        }
        val imported = second.single().first
        finish.complete(Unit)
        flush()

        assertEquals(listOf(temp to null), first)
        assertEquals(listOf(imported to null, "https://github.com/o/r/pull/7" to imported), second)
        assertTrue(controller.isPending(temp))

        gate.complete(Unit)
        flush()

        assertEquals(listOf(temp to null, "feature/y" to temp), first)
        assertEquals(listOf(imported to null, "https://github.com/o/r/pull/7" to imported), second)
        assertFalse(controller.isPending(temp))
    }

    fun `test created worktrees are announced once they exist`() {
        val controller = controller()
        val created = mutableListOf<WorktreeDto>()
        controller.onCreated = { created.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        // Nothing exists on disk while the create is still pending.
        assertEquals(emptyList<WorktreeDto>(), created)
        flush()

        assertEquals(listOf("feature/y"), created.map { it.branch })
    }

    fun `test creation placement runs on the EDT before publishing and selecting the row`() {
        val controller = controller()
        val calls = mutableListOf<String>()
        controller.onSelect = { if (!controller.isPending(it)) calls.add("select") }
        controller.onCreated = { calls.add("created") }

        ApplicationManager.getApplication().invokeAndWait {
            controller.create("feature/y", null, place = { id, previous ->
                assertTrue(ApplicationManager.getApplication().isDispatchThread)
                if (previous == null) {
                    assertTrue(controller.isPending(id))
                    assertEquals(0, controller.model.size)
                    calls.add("pending")
                    return@create
                }
                assertTrue(previous.startsWith("pending:"))
                assertEquals(previous, controller.model.getElementAt(0).id)
                assertEquals("feature/y", id)
                calls.add("place")
            })
        }
        flush()

        assertEquals(listOf("pending", "place", "select", "created"), calls)
    }

    fun `test a failed create announces nothing`() {
        rpc.createResult = { CreateWorktreeResultDto(error = "boom") }
        val controller = controller()
        val created = mutableListOf<WorktreeDto>()
        controller.onCreated = { created.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        flush()

        assertEquals(emptyList<WorktreeDto>(), created)
    }

    fun `test create failure removes placeholder and reports the error`() {
        rpc.createResult = { CreateWorktreeResultDto(error = "boom") }
        val controller = controller()
        val failures = mutableListOf<CreateFailure>()
        val placed = mutableListOf<Pair<String, String?>>()
        controller.onCreateFailure = { failures.add(it) }

        ApplicationManager.getApplication().invokeAndWait {
            controller.create("feature/y", null, place = { id, previous -> placed += id to previous })
        }
        val id = controller.model.getElementAt(0).id
        assertTrue(controller.isPending(id))
        flush()

        assertEquals(0, controller.model.size)
        assertFalse(controller.isPending(id))
        assertEquals(listOf(id to null), placed)
        assertEquals(listOf(CreateFailure("boom", CreateKind.CREATE, "feature/y")), failures)
    }

    fun `test reload preserves pending worktrees`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        val id = controller.model.getElementAt(0).id
        controller.reload()
        flush()

        assertEquals(listOf("feature/y", "feature/x"), (0 until controller.model.size).map { controller.model.getElementAt(it).branch })
        assertTrue(controller.isPending(id))
        gate.complete(Unit)
        flush()
    }

    fun `test reload discovering an in flight checkout reconciles completion without duplicate keys`() {
        val created = WorktreeDto("/wt/race", "race", "race", "/wt/race")
        val prompt = PendingPrompt("keep this prompt", "plan", "kilo", "gpt-5", "high")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        rpc.createResult = { CreateWorktreeResultDto(created) }
        val controller = controller()
        val tree = tree(controller)
        val completed = mutableListOf<WorktreeDto>()
        controller.onSelect = { tree.select(it, false) }
        controller.onCreated = { completed += it }

        ApplicationManager.getApplication().invokeAndWait { controller.create("race", "main", prompt = prompt) }
        val temp = controller.model.getElementAt(0)
        rpc.listed += created.copy(locked = true, lockReason = "initializing")
        controller.reload()
        flush()

        assertEquals("only the placeholder is published until git finishes", listOf(temp), controller.model.items)
        assertTrue(controller.isPending(temp.id))
        assertNotNull(controller.progress(temp.id))
        gate.complete(Unit)
        flush()

        assertEquals(listOf(created), controller.model.items)
        assertFalse(controller.isPending(temp.id))
        assertFalse(controller.isPending(created.id))
        assertNull(controller.progress(temp.id))
        assertNull(controller.progress(created.id))
        assertEquals(listOf(created), completed)
        assertEquals(1, (tree.preferredFocus() as ActiveTreeView).rowCount)
        assertEquals(listOf(created.id), tree.selectedKeys())
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test completion rejects older reloads with a missing checkout or a temporary lock`() {
        val created = WorktreeDto("/wt/stale", "stale", "stale", "/wt/stale")
        for (rows in listOf(emptyList(), listOf(created.copy(locked = true, lockReason = "initializing")))) {
            val creation = CompletableDeferred<Unit>()
            val listing = CompletableDeferred<Unit>()
            val entered = CompletableDeferred<Unit>()
            rpc.listed.clear()
            rpc.listed += rows
            rpc.beforeCreate = { creation.await() }
            rpc.beforeList = { entered.complete(Unit); listing.await() }
            rpc.createResult = { CreateWorktreeResultDto(created) }
            val controller = controller()
            val tree = tree(controller)
            val prompt = PendingPrompt("do not replay $rows", "plan", "kilo", "gpt-5", "high")
            val completed = mutableListOf<WorktreeDto>()
            controller.onCreated = { completed += it }
            ApplicationManager.getApplication().invokeAndWait { controller.create("stale", "main", prompt = prompt) }
            val temp = controller.model.getElementAt(0)
            controller.reload()
            flush()
            assertTrue("the old listing must have captured its response", entered.isCompleted)

            creation.complete(Unit)
            flush()
            assertEquals(listOf(created), controller.model.items)
            listing.complete(Unit)
            flush()

            assertEquals(listOf(created), controller.model.items)
            assertFalse(controller.isPending(temp.id))
            assertNull(controller.progress(temp.id))
            assertNull(controller.progress(created.id))
            assertFalse(controller.model.getElementAt(0).locked)
            assertEquals(1, (tree.preferredFocus() as ActiveTreeView).rowCount)
            assertEquals(listOf(created), completed)
            ApplicationManager.getApplication().invokeAndWait {
                assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
            }
        }
    }

    fun `test completion upserts a discovered normalized path when the branch was unknown`() {
        val created = WorktreeDto("/wt/pr-race", "pr-race", "pr-race", "/wt/pr-race")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        rpc.importPrResult = { CreateWorktreeResultDto(created) }
        val controller = controller()
        val tree = tree(controller)
        ApplicationManager.getApplication().invokeAndWait { controller.importPr("https://github.com/o/r/pull/7") }
        val temp = controller.model.getElementAt(0)
        rpc.listed += created.copy(id = "listed:pr-race", path = "${created.path}/", locked = true)
        controller.reload()
        flush()
        assertEquals(2, controller.model.size)

        gate.complete(Unit)
        flush()

        assertEquals(listOf(created), controller.model.items)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        assertFalse(controller.model.items.single().locked)
        assertEquals(1, (tree.preferredFocus() as ActiveTreeView).rowCount)
    }

    fun `test completion rejects an older branch poll containing a temporary lock`() {
        val created = WorktreeDto("/wt/poll-race", "poll-race", "poll-race", "/wt/poll-race")
        val creation = CompletableDeferred<Unit>()
        val listing = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val controller = controller()
        controller.reload()
        flush()
        rpc.beforeCreate = { creation.await() }
        rpc.createResult = { CreateWorktreeResultDto(created) }
        ApplicationManager.getApplication().invokeAndWait { controller.create("poll-race", "main") }
        val temp = controller.model.items.single()
        rpc.listed.set(0, rpc.listed.first().copy(branch = "stale"))
        rpc.listed += created.copy(locked = true)
        rpc.beforeList = { entered.complete(Unit); listing.await() }
        controller.refreshBranches()
        flush()
        assertTrue(entered.isCompleted)

        creation.complete(Unit)
        flush()
        listing.complete(Unit)
        flush()

        assertEquals(listOf(created), controller.model.items)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        assertFalse(controller.model.items.single().locked)
        assertEquals("main", controller.current?.branch)
    }

    fun `test thrown creation failure clears pending progress and allows retry`() {
        rpc.createResult = { error("disconnected") }
        val controller = controller()
        val prompt = PendingPrompt("retry after disconnection", "plan", "kilo", "gpt-5", "high")
        val failures = mutableListOf<CreateFailure>()
        controller.onCreateFailure = { failures += it }
        ApplicationManager.getApplication().invokeAndWait { controller.create("retry", "main", prompt = prompt) }
        val temp = controller.model.getElementAt(0)
        flush()

        assertTrue(controller.model.isEmpty)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        assertEquals(listOf(CreateFailure("disconnected", CreateKind.CREATE, "retry")), failures)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().draft("/test")?.prompt)
        }

        rpc.createResult = { CreateWorktreeResultDto(WorktreeDto("/wt/retry", "retry", "retry", "/wt/retry")) }
        ApplicationManager.getApplication().invokeAndWait { controller.create("retry", "main", prompt = prompt) }
        flush()
        assertEquals("/wt/retry", controller.model.items.single().path)
        assertFalse(controller.isPending(controller.model.items.single().id))
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreePrompt>().draft("/test"))
            assertEquals(prompt, service<PendingWorktreePrompt>().peek("/wt/retry")?.prompt)
        }
    }

    fun `test cancelled creation clears progress without losing the draft`() {
        val prompt = PendingPrompt("retry after cancellation", "plan", "kilo", "gpt-5", "high")
        rpc.createResult = { throw CancellationException("cancelled") }
        val controller = controller()
        ApplicationManager.getApplication().invokeAndWait { controller.create("cancelled", "main", prompt = prompt) }
        val temp = controller.model.getElementAt(0)
        flush()

        assertTrue(controller.model.isEmpty)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().draft("/test")?.prompt)
        }
    }

    fun `test cancellation before creation starts releases its draft protection`() {
        val job = Job().apply { cancel() }
        val scope = CoroutineScope(coroutines.scope.coroutineContext + job)
        val controller = WorktreeController(service, "/test", scope, telemetry = { _, _ -> })
        val prompt = PendingPrompt("cancelled before start")

        ApplicationManager.getApplication().invokeAndWait {
            controller.create("cancelled", "main", prompt = prompt)
        }
        flush()

        assertTrue(controller.model.isEmpty)
        assertTrue(rpc.creates.isEmpty())
        ApplicationManager.getApplication().invokeAndWait {
            val store = service<PendingWorktreePrompt>()
            assertEquals(prompt, store.draft("/test")?.prompt)
            store.remember("/test", "retry", "main", PendingPrompt("replacement"))
            assertEquals(1, store.getState().entries.size)
        }
    }

    fun `test failed creation retains its complete draft across reload and retry`() {
        val prompt = PendingPrompt("retry this creation", "plan", "kilo", "gpt-5", "high")
        val created = WorktreeDto("/wt/retry-prompt", "retry-prompt", "retry-prompt", "/wt/retry-prompt")
        rpc.createResult = { CreateWorktreeResultDto(error = "fetch failed") }
        val controller = controller()
        ApplicationManager.getApplication().invokeAndWait {
            controller.create("retry-prompt", "develop", prompt = prompt, fetchBase = true)
        }
        val temp = controller.model.getElementAt(0)
        flush()
        controller.reload()
        flush()

        assertTrue(controller.model.isEmpty)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        ApplicationManager.getApplication().invokeAndWait {
            val draft = service<PendingWorktreePrompt>().draft("/test")!!
            assertEquals(prompt, draft.prompt)
            assertEquals("retry-prompt", draft.branch)
            assertEquals("develop", draft.base)
            assertTrue(draft.fetchBase)
            assertNull(draft.path)
            rpc.createResult = { CreateWorktreeResultDto(created) }
            controller.create(draft.branch, draft.base, prompt = draft.prompt, fetchBase = draft.fetchBase)
        }
        flush()

        assertEquals(listOf(created), controller.model.items)
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreePrompt>().draft("/test"))
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test failed creation never assigns its prompt to an existing checkout on the same branch`() {
        val existing = WorktreeDto("/wt/existing", "existing", "occupied", "/wt/existing")
        val prompt = PendingPrompt("keep as a creation draft", "plan", "kilo", "gpt-5", "high")
        val gate = CompletableDeferred<Unit>()
        rpc.listed += existing
        rpc.beforeCreate = { gate.await() }
        rpc.createResult = { CreateWorktreeResultDto(error = "branch already checked out") }
        val controller = controller()
        controller.reload()
        flush()
        ApplicationManager.getApplication().invokeAndWait { controller.create("occupied", "main", prompt = prompt) }
        controller.reload()
        flush()
        assertTrue(controller.isPending(controller.model.items.single().id))

        gate.complete(Unit)
        flush()

        assertEquals(listOf(existing), controller.model.items)
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreePrompt>().peek(existing.path))
            assertEquals(prompt, service<PendingWorktreePrompt>().draft("/test")?.prompt)
        }
    }

    fun `test prompt is retained before a synchronous model listener can throw`() {
        val prompt = PendingPrompt("survive list publication", "plan", "kilo", "gpt-5", "high")
        val created = WorktreeDto("/wt/list-failure", "list-failure", "list-failure", "/wt/list-failure")
        rpc.createResult = { CreateWorktreeResultDto(created) }
        val controller = controller()
        val completed = mutableListOf<WorktreeDto>()
        val observed = mutableListOf<PendingPrompt?>()
        val listener = object : ListDataListener {
            fun update() {
                val row = controller.model.items.singleOrNull() ?: return
                val journal = service<PendingWorktreePrompt>()
                observed += if (controller.isPending(row.id)) journal.draft("/test")?.prompt else journal.peek(row.path)?.prompt
                if (row.id == created.id) error("listener failed")
            }
            override fun intervalAdded(event: ListDataEvent) = update()
            override fun intervalRemoved(event: ListDataEvent) = update()
            override fun contentsChanged(event: ListDataEvent) = update()
        }
        controller.model.addListDataListener(listener)
        controller.onCreated = { completed += it }

        ApplicationManager.getApplication().invokeAndWait { controller.create("list-failure", "main", prompt = prompt) }
        val temp = controller.model.getElementAt(0)
        flush()

        assertTrue("both placeholder and completion must notify the failing listener", observed.size >= 2)
        assertTrue("every published row must already have its recoverable prompt", observed.all { it == prompt })
        assertEquals(listOf(created), controller.model.items)
        assertFalse(controller.isPending(temp.id))
        assertNull(controller.progress(temp.id))
        assertEquals(listOf(created), completed)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
        controller.model.removeListDataListener(listener)
        rpc.listed += created
        controller.reload()
        flush()
        assertEquals(listOf(created), controller.model.items)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test editor opening failure does not prevent completion callbacks or lose the prompt`() {
        val created = WorktreeDto("/wt/open-failure", "open-failure", "open-failure", "/wt/open-failure")
        val prompt = PendingPrompt("recover after opening fails", "plan", "kilo", "gpt-5", "high")
        rpc.createResult = { CreateWorktreeResultDto(created) }
        val controller = controller()
        val completed = mutableListOf<WorktreeDto>()
        controller.onSelect = { if (it == created.id) error("editor unavailable") }
        controller.onCreated = { completed += it }

        ApplicationManager.getApplication().invokeAndWait { controller.create("open-failure", "main", prompt = prompt) }
        val temp = controller.model.getElementAt(0)
        flush()

        assertEquals(listOf(created), controller.model.items)
        assertNull(controller.progress(temp.id))
        assertFalse(controller.isPending(temp.id))
        assertEquals(listOf(created), completed)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test remove invokes rpc and removes from the model`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()
        ApplicationManager.getApplication().invokeAndWait {
            service<PendingWorktreePrompt>().put("/test", item.path, PendingPrompt("obsolete after deletion"))
        }

        var success = false
        val removed = mutableListOf<WorktreeDto>()
        controller.onRemoveSuccess = { dto, _ -> removed.add(dto) }
        controller.remove(controller.model.getElementAt(0), onSuccess = { success = true })
        flush()

        assertEquals(listOf("/test" to item.path), run.releases.toList())
        assertEquals(listOf(Triple("/test", item.path, "feature/x")), rpc.removes.toList())
        assertEquals(0, controller.model.size)
        assertTrue(success)
        assertEquals(listOf(item), removed)
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreePrompt>().peek(item.path))
        }
    }

    fun `test remove waits for process release and ignores duplicate removal`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        run.beforeRelease = { gate.await() }
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(item)
        flush()

        assertEquals(listOf("/test" to item.path), run.releases.toList())
        assertTrue(rpc.removes.isEmpty())
        assertEquals(KiloBundle.message("common.deleting"), controller.progress(item.id))
        assertEquals(1, controller.model.size)

        controller.remove(item)
        flush()

        assertEquals(1, run.releases.size)
        assertTrue(rpc.removes.isEmpty())

        gate.complete(Unit)
        flush()

        assertEquals(listOf(Triple("/test", item.path, "feature/x")), rpc.removes.toList())
        assertNull(controller.progress(item.id))
        assertEquals(0, controller.model.size)
    }

    fun `test remove marks the row deleting until it resolves`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.listed += item
        rpc.beforeRemove = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(controller.model.getElementAt(0))

        assertEquals(KiloBundle.message("common.deleting"), controller.progress(item.id))
        assertEquals(1, controller.model.size)

        gate.complete(Unit)
        flush()

        assertNull(controller.progress(item.id))
        assertEquals(0, controller.model.size)
    }

    fun `test failed remove keeps the row and invokes the failure callback`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.removeResult = { _, _, _ -> RemoveWorktreeResultDto(error = "cannot remove a locked working tree", locked = true) }
        val controller = controller()
        controller.reload()
        flush()
        ApplicationManager.getApplication().invokeAndWait {
            service<PendingWorktreePrompt>().put("/test", item.path, PendingPrompt("retain after failed deletion"))
        }

        val failures = mutableListOf<RemoveWorktreeResultDto>()
        controller.remove(controller.model.getElementAt(0), onFailure = { failures.add(it) })
        flush()

        // git rejected the removal, so the entry must remain instead of vanishing optimistically.
        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertNull(controller.progress(item.id))
        assertEquals(1, failures.size)
        assertTrue(failures.first().locked)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals("retain after failed deletion", service<PendingWorktreePrompt>().peek(item.path)?.text)
        }
    }

    fun `test only authoritative repository listings prune missing worktree prompts`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val controller = controller()
        val store = service<PendingWorktreePrompt>()
        ApplicationManager.getApplication().invokeAndWait {
            val id = requireNotNull(store.remember("/test", "removed", "main", PendingPrompt("obsolete")))
            store.bind(id, "/checkout/removed")
        }
        controller.reload()
        flush()
        ApplicationManager.getApplication().invokeAndWait {
            assertNotNull(store.peek("/checkout/removed"))
        }

        rpc.listed += main
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait {
            assertNull(store.peek("/checkout/removed"))
        }
    }

    fun `test an older listing from another controller cannot prune a newly created prompt`() {
        val created = WorktreeDto("/checkout/new", "new", "new", "/checkout/new")
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val listing = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        rpc.beforeList = { entered.complete(Unit); listing.await() }
        rpc.createResult = { CreateWorktreeResultDto(created) }
        val first = controller()
        first.reload()
        flush()
        assertTrue(entered.isCompleted)
        val second = controller()
        val prompt = PendingPrompt("keep the newer prompt", "plan", "kilo", "gpt-5", "high")
        ApplicationManager.getApplication().invokeAndWait { second.create("new", "main", prompt = prompt) }
        flush()
        listing.complete(Unit)
        flush()

        assertEquals(listOf(created), second.model.items)
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals(prompt, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test branch polling prunes externally removed queued prompts even when rows are unchanged`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += main
        val controller = controller()
        val store = service<PendingWorktreePrompt>()
        controller.reload()
        flush()
        ApplicationManager.getApplication().invokeAndWait {
            store.put("/test", "/checkout/removed", PendingPrompt("queued after the previous listing"))
        }

        controller.refreshBranches()
        flush()

        assertEquals(main, controller.current)
        assertTrue(controller.model.isEmpty)
        ApplicationManager.getApplication().invokeAndWait { assertNull(store.peek("/checkout/removed")) }
    }

    fun `test creating without a prompt clears any old checkout incarnation prompt`() {
        val created = WorktreeDto("/checkout/reused", "reused", "reused", "/checkout/reused")
        val controller = controller()
        rpc.createResult = { CreateWorktreeResultDto(created) }
        ApplicationManager.getApplication().invokeAndWait {
            service<PendingWorktreePrompt>().put("/test", created.path, PendingPrompt("obsolete incarnation"))
            controller.create("reused", "main")
        }
        flush()

        assertEquals(listOf(created), controller.model.items)
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreePrompt>().peek(created.path))
        }
    }

    fun `test refused nested remove keeps the row and surfaces the error`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val nestedPath = "/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested"
        rpc.listed += item
        rpc.removeResult = { _, _, _ ->
            RemoveWorktreeResultDto(error = "Delete nested worktrees first:\n$nestedPath", nestedPaths = listOf(nestedPath))
        }
        val controller = controller()
        controller.reload()
        flush()

        val failures = mutableListOf<RemoveWorktreeResultDto>()
        controller.remove(controller.model.getElementAt(0), onFailure = { failures.add(it) })
        flush()

        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertNull(controller.progress(item.id))
        assertEquals(listOf(false), rpc.removeForces.toList())
        assertEquals("Delete nested worktrees first:\n$nestedPath", failures.single().error)
        // nestedPaths must survive the controller's pass-through unchanged, since the panel
        // reads it directly to build the copy-path/reveal notification actions.
        assertEquals(listOf(nestedPath), failures.single().nestedPaths)
    }

    fun `test reveal routes the path to the backend rpc`() {
        val controller = controller()

        var failed = false
        controller.reveal("/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested") { failed = true }
        flush()

        assertEquals(listOf("/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested"), rpc.revealPaths.toList())
        assertFalse(failed)
    }

    fun `test reveal reports failure when the backend can't reveal the path`() {
        val controller = controller()
        rpc.revealPathResult = { false }

        var failed = false
        controller.reveal("/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested") { failed = true }
        flush()

        assertTrue(failed)
    }

    fun `test force remove passes the force flag and drops the row on success`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x", locked = true)
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(controller.model.getElementAt(0), force = true)
        flush()

        assertEquals(listOf(true), rpc.removeForces.toList())
        assertEquals(0, controller.model.size)
    }

    fun `test rename optimistically updates and keeps successful result`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.listed += item
        rpc.beforeRename = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.rename(controller.model.getElementAt(0), "Feature Label") }

        assertEquals("Feature Label", controller.model.getElementAt(0).name)
        assertEquals("Feature Label", cache().get(item.path))
        assertTrue(rpc.renames.isEmpty())

        gate.complete(Unit)
        flush()

        assertEquals(listOf(Triple("/test", item.path, "Feature Label")), rpc.renames.toList())
        assertEquals("Feature Label", controller.model.getElementAt(0).name)
        assertEquals("Feature Label", cache().get(item.path))
    }

    fun `test rename failure reverts row and invokes callback`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.renameResult = { _, _ -> RenameWorktreeResultDto(error = "cannot rename") }
        val failures = mutableListOf<String?>()
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait {
            controller.rename(controller.model.getElementAt(0), "Feature Label", onFailure = { failures += it })
        }
        flush()

        assertEquals("feature-x", controller.model.getElementAt(0).name)
        assertEquals(listOf("cannot rename"), failures)
        assertEquals("feature-x", cache().get(item.path))
    }

    fun `test reload derives default branch from the main worktree`() {
        rpc.listed += WorktreeDto("/repo", "repo", "trunk", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals("trunk", controller.defaultBranch)
    }

    fun `test reload caches the local branch list`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.branchesList += listOf("main", "feature/x", "release/1.0")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals(listOf("main", "feature/x", "release/1.0"), controller.branches)
    }

    fun `test the controller resolves the origin repo slug without a reload`() {
        rpc.originSlug = "Kilo-Org/kilocode"

        val controller = controller()
        flush()

        // The New Worktree dialog can open before any reload runs, so construction alone has to arm
        // the cross-repo check.
        assertEquals("Kilo-Org/kilocode", controller.origin)
    }

    fun `test reload caches the origin repo slug`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val controller = controller()
        // Let the construction-time lookup settle while there is no slug to find, so the assertion
        // below can only be satisfied by reload() assigning it.
        flush()
        assertNull(controller.origin)
        rpc.originSlug = "Kilo-Org/kilocode"

        controller.reload()
        flush()

        assertEquals("Kilo-Org/kilocode", controller.origin)
    }

    fun `test base branches exclude branches checked out in worktrees`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.branchesList += listOf("main", "feature/x", "develop")
        val controller = controller()

        controller.reload()
        flush()

        // main (main worktree branch) stays; feature/x (a worktree branch) is excluded.
        assertEquals(listOf("main", "develop"), controller.branches)
    }

    fun `test quick create generates a friendly name based on the default branch`() {
        rpc.listed += WorktreeDto("/repo", "repo", "trunk", "/repo", main = true)
        val controller = controller()
        controller.reload()
        flush()

        controller.quickCreate()
        flush()

        assertEquals(1, rpc.creates.size)
        val req = rpc.creates.first()
        assertEquals("trunk", req.baseBranch)
        assertTrue("generated '${req.branch}'", req.branch.matches(Regex("[a-z]+-[a-z]+(-\\d+)?")))
        assertEquals(1, controller.model.size)
    }

    fun `test import branch creates a worktree on an existing branch`() {
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.importBranch("feature/x") }
        flush()

        val req = rpc.creates.single()
        assertEquals("feature/x", req.branch)
        assertTrue("should check out an existing branch", req.existingBranch)
        assertEquals(1, controller.model.size)
    }

    fun `test successful import reconciles branch choices before callbacks and rejects older metadata`() {
        val gate = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.branchesList += listOf("main", "feature/x", "develop")
        val controller = controller()
        controller.reload()
        flush()
        assertTrue("the imported branch starts eligible", "feature/x" in controller.branches)
        rpc.beforeList = { entered.complete(Unit); gate.await() }
        controller.reload()
        flush()
        assertTrue(entered.isCompleted)
        val choices = mutableListOf<List<String>>()
        controller.onCreated = { choices += controller.branches }

        ApplicationManager.getApplication().invokeAndWait { controller.importBranch("feature/x") }
        flush()
        assertEquals(listOf(listOf("main", "develop")), choices)
        gate.complete(Unit)
        flush()

        assertEquals(listOf("main", "develop"), controller.branches)
        assertEquals("feature/x", controller.model.items.single().branch)
    }

    fun `test import pr creates a worktree from the pr url`() {
        rpc.importPrResult = { CreateWorktreeResultDto(WorktreeDto("/wt/pr-7", "pr-7", "pr-7", "/wt/pr-7")) }
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.importPr("https://github.com/o/r/pull/7") }
        flush()

        assertEquals(listOf("https://github.com/o/r/pull/7"), rpc.prImports)
        assertEquals("/wt/pr-7", controller.model.getElementAt(0).path)
    }

    fun `test move adds placeholder tracks progress and swaps to worktree`() {
        val done = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.TRANSFERRING),
            MoveProgressDto(MoveStage.FORKING),
            MoveProgressDto(MoveStage.DONE, worktree = done, session = "ses_fork"),
        )
        val selected = mutableListOf<String>()
        val aborts = mutableListOf<Pair<String, String>>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(abort = { id, dir -> aborts += id to dir }, telemetry = { name, props -> events += name to props })
        controller.onSelect = { selected += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move("ses_source", "/repo") }
        val temp = controller.model.getElementAt(0)
        assertTrue(controller.isPending(temp.id))
        assertEquals(KiloBundle.message("worktree.progress.capturing"), controller.progress(temp.id))
        assertEquals(temp.id, selected.single())
        flush()

        assertEquals(listOf("ses_source" to "/repo"), aborts)
        assertEquals("/repo", rpc.moves.single().first)
        assertEquals("ses_source", rpc.moves.single().second)
        assertEquals(done, controller.model.getElementAt(0))
        assertNull(controller.progress(temp.id))
        // The forked session is queued for the editor the selection opens, keyed by worktree path,
        // so the tab identity stays the path alone. One-shot: a second open starts a new session.
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals("ses_fork", service<PendingWorktreeSession>().take(done.path))
            assertNull(service<PendingWorktreeSession>().take(done.path))
        }
        assertEquals(done.id, selected.last())
        assertTrue(
            events.any {
                it.first == "Continue in Worktree" && it.second["surface"] == "sidebar" && it.second["session"] == "true"
            },
        )
    }

    fun `test move reports the caller's surface on the telemetry event`() {
        // Reuses "test move without a session..."'s no-session DONE event (no `session` field) so
        // this leaves nothing in the app-level PendingWorktreeSession service for another test in
        // this file to trip over.
        val done = WorktreeDto("/wt/moved-surface", "moved-surface", "moved-surface", "/wt/moved-surface")
        rpc.moveScript = listOf(MoveProgressDto(MoveStage.DONE, worktree = done))
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(telemetry = { name, props -> events += name to props })

        ApplicationManager.getApplication().invokeAndWait { controller.move("ses_source", "/repo", "worktree_editor") }
        flush()

        assertTrue(events.any { it.first == "Continue in Worktree" && it.second["surface"] == "worktree_editor" })
    }

    fun `test move without a session transfers changes and skips forking`() {
        val done = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.TRANSFERRING),
            MoveProgressDto(MoveStage.DONE, worktree = done),
        )
        val selected = mutableListOf<String>()
        val aborts = mutableListOf<Pair<String, String>>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(abort = { id, dir -> aborts += id to dir }, telemetry = { name, props -> events += name to props })
        controller.onSelect = { selected += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move(null, "/repo") }
        flush()

        assertTrue("a session-less move has no turn to abort", aborts.isEmpty())
        assertEquals("/repo", rpc.moves.single().first)
        assertNull(rpc.moves.single().second)
        assertEquals(done, controller.model.getElementAt(0))
        // Nothing is queued for the worktree editor, so opening it starts a fresh session.
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreeSession>().take(done.path))
        }
        assertEquals(done.id, selected.last())
        assertTrue(events.any { it.first == "Continue in Worktree" && it.second["session"] == "false" })
    }

    fun `test duplicate move without a session is ignored while in flight`() {
        rpc.moveScript = listOf(MoveProgressDto(MoveStage.DONE, worktree = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")))
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait {
            controller.move(null, "/repo")
            controller.move(null, "/repo")
        }
        flush()

        assertEquals(1, controller.model.size)
        assertEquals(1, rpc.moves.size)
    }

    fun `test move failure removes placeholder and reports last stage`() {
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.ERROR, error = "boom"),
        )
        val failures = mutableListOf<String?>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(telemetry = { name, props -> events += name to props })
        controller.onMoveFailure = { failures += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move("ses_source", "/repo") }
        flush()

        assertEquals(0, controller.model.size)
        assertEquals(listOf("boom"), failures)
        assertTrue(events.any { it.first == "Continue in Worktree Failed" && it.second["stage"] == "CREATING" })
    }

    fun `test duplicate move for session is ignored while in flight`() {
        val gate = CompletableDeferred<Unit>()
        rpc.moveScript = listOf(MoveProgressDto(MoveStage.DONE, worktree = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")))
        val controller = controller(abort = { _, _ -> gate.await() })

        ApplicationManager.getApplication().invokeAndWait {
            controller.move("ses_source", "/repo")
            controller.move("ses_source", "/repo")
        }
        flush()

        assertEquals(1, controller.model.size)
        assertEquals(0, rpc.moves.size)
        gate.complete(Unit)
        flush()

        assertEquals(1, rpc.moves.size)
    }

    fun `test create stashes the prompt with its picked selection for the created worktree`() {
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait {
            controller.create(
                "feature/y",
                null,
                prompt = PendingPrompt("fix the bug", agent = "plan", provider = "kilo", model = "gpt-5", variant = "high"),
            )
        }
        flush()

        val created = controller.model.getElementAt(0)
        ApplicationManager.getApplication().invokeAndWait {
            val stashed = service<PendingWorktreePrompt>().peek(created.path)?.prompt
            assertEquals(PendingPrompt("fix the bug", "plan", "kilo", "gpt-5", "high"), stashed)
            // Publishing a row is not acknowledgement that the first session received it.
            assertEquals(stashed, service<PendingWorktreePrompt>().peek(created.path)?.prompt)
        }
    }

    fun `test name generator avoids taken names`() {
        val taken = setOf("ambitious-keyboard", "brave-otter")
        repeat(50) {
            val name = WorktreeNames.generate(taken)
            assertFalse(name in taken)
            assertTrue("generated '$name'", name.matches(Regex("[a-z]+-[a-z]+(-\\d+)?")))
        }
    }

    fun `test worktree row icons show while running, waiting or failed`() {
        assertSame(
            WorktreeIcons.spinner,
            WorktreeIcons.forRow(busy = true, kind = SessionActivityKind.RUNNING),
        )
        assertSame(
            WorktreeIcons.running,
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING),
        )
        assertSame(
            SessionActivityKind.QUESTION.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.QUESTION),
        )
        assertSame(
            SessionActivityKind.PLAN.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.PLAN),
        )
        assertSame(
            SessionActivityKind.ERROR.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.ERROR),
        )
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(busy = false, kind = null))
    }

    fun `test worktree icons load at the same size`() {
        // Loading an svg asset resolves to a 1x1 placeholder while the platform is headless, which is
        // how CI runs, so switch real loading on for the assertions and put the ambient state back.
        IconLoader.activate()
        try {
            assertTrue("branch icon should load", WorktreeIcons.branch.iconWidth > 1)
            assertTrue("lock icon should load", WorktreeIcons.locked.iconWidth > 1)
            assertTrue("local icon should load", WorktreeIcons.local.iconWidth > 1)
            assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.locked.iconWidth)
            assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.locked.iconHeight)
            assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.local.iconWidth)
            assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.local.iconHeight)
            for (kind in SessionActivityKind.entries) {
                assertEquals(WorktreeIcons.branch.iconWidth, kind.icon().iconWidth)
                assertEquals(WorktreeIcons.branch.iconHeight, kind.icon().iconHeight)
            }
        } finally {
            if (GraphicsEnvironment.isHeadless()) IconLoader.deactivate()
        }
    }

    fun `test activity icons are stable per kind`() {
        assertSame(SessionActivityKind.RUNNING.icon(), SessionActivityKind.RUNNING.icon())
        assertNotSame(SessionActivityKind.RUNNING.icon(), SessionActivityKind.ERROR.icon())
    }

    fun `test worktree delete eligibility excludes missing main and pending rows`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val child = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")

        assertFalse(worktreeDeletable(null, busy = false))
        assertFalse(worktreeDeletable(main, busy = false))
        assertFalse(worktreeDeletable(child, busy = true))
        assertTrue(worktreeDeletable(child, busy = false))
    }

    fun `test applyName updates the matching row so an adopted name shows live`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.applyName(item.path, "Repository overview request") }

        assertEquals("Repository overview request", controller.model.getElementAt(0).name)
    }

    fun `test applyName ignores unknown paths, identical names, and blanks`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()
        val before = controller.model.getElementAt(0)

        ApplicationManager.getApplication().invokeAndWait {
            controller.applyName("/repo/.kilo/worktrees/other", "Ignored")
            controller.applyName(item.path, "feature-x")
            controller.applyName(item.path, null)
        }

        assertSame(before, controller.model.getElementAt(0))
    }

    fun `test activity flow updates worktree kind and notifies on EDT`() {
        val activity = MutableStateFlow<Map<String, SessionActivityDto>>(emptyMap())
        val controller = controller(activity)
        val calls = mutableListOf<Boolean>()
        controller.onActivityChanged = { calls.add(ApplicationManager.getApplication().isDispatchThread) }

        activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt/", SessionActivityKindDto.RUNNING))
        flush()

        assertEquals(SessionActivityKind.RUNNING, controller.kind("/repo/wt"))
        assertEquals(SessionActivityKind.RUNNING, controller.kind("/repo/wt/"))
        assertTrue(calls.isNotEmpty())
        assertTrue(calls.all { it })
    }

    fun `test cache notifies on single put and remove but not on bulk sync`() {
        val cache = cache()
        val events = mutableListOf<Pair<String, String?>>()
        cache.addListener(testRootDisposable) { path, name -> events += path to name }

        ApplicationManager.getApplication().invokeAndWait {
            cache.put("/wt", "Name")
            cache.put("/wt", "Name")
            cache.putAll(listOf(WorktreeDto("/wt2", "Two", "b", "/wt2")))
            cache.remove("/wt")
            cache.remove("/wt")
        }

        assertEquals(listOf("/wt" to "Name", "/wt" to null), events)
    }

    private fun controller(
        activity: MutableStateFlow<Map<String, SessionActivityDto>> = MutableStateFlow(emptyMap()),
        abort: suspend (String, String) -> Unit = { _, _ -> },
        telemetry: (String, Map<String, String>) -> Unit = { _, _ -> },
    ) = WorktreeController(service, "/test", coroutines.scope, activity = activity, abort = abort, telemetry = telemetry)

    private fun flush() = coroutines.drain(::pump)

    private fun tree(controller: WorktreeController): ActiveTree {
        val tree = ActiveTree("")
        fun update() {
            tree.update(controller.model.items.map { row ->
                ActiveTreeNode(object : ActiveItem {
                    override val key = row.id
                    override val title = row.name
                })
            })
        }
        controller.model.addListDataListener(object : ListDataListener {
            override fun intervalAdded(event: ListDataEvent) = update()
            override fun intervalRemoved(event: ListDataEvent) = update()
            override fun contentsChanged(event: ListDataEvent) = update()
        })
        update()
        return tree
    }

    private fun cache(): WorktreeNameCache = ApplicationManager.getApplication().service()

    private fun pump() = pumpEdt()
}
