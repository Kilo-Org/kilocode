package ai.kilocode.client.agentManager.orphans

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.orphans.OrphanDto
import ai.kilocode.rpc.dto.orphans.OrphanKind
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.HyperlinkLabel
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * [OrphanBanner] visibility and text follow [WorktreeController.orphans], which [WorktreeController.reload]
 * fills from the same `list()` RPC the worktree list itself uses — so these tests drive [refresh]
 * directly against a controller already reloaded, mirroring how [AgentManagerPanel] wires it through
 * `controller.onReload`.
 */
@Suppress("UnstableApiUsage")
class OrphanBannerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var service: KiloWorktreeService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        service = KiloWorktreeService(coroutines.scope, rpc)
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(KiloAppService::class.java, KiloAppService(coroutines.scope, FakeAppRpcApi()), testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test banner is hidden when there are no orphans`() {
        val controller = controller()
        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }

        assertFalse(edt { banner.isVisible })
    }

    fun `test banner shows the count immediately then fills in size once the size pass lands`() {
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val gate = CompletableDeferred<Unit>()
        rpc.beforeOrphanSizes = { gate.await() }
        rpc.orphanSizesResult = { mapOf("/repo/.kilo/worktrees/leftover" to 2048L) }
        val controller = controller()
        edt { controller.reload() }
        flush()

        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()

        assertTrue(edt { banner.isVisible })
        assertEquals("1 leftover worktree folder(s) \u00b7 calculating size\u2026", edt { banner.text })

        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { edt { banner.text } != "1 leftover worktree folder(s) \u00b7 calculating size\u2026" })

        // The exact size format is StringUtil.formatFileSize's own choice — only assert the size
        // pass landed, not the number's presentation.
        val filled = edt { banner.text }
        assertTrue("expected the size to be appended -> $filled", filled.startsWith("1 leftover worktree folder(s) \u00b7 "))
        assertNotNull(edt { links(banner).singleOrNull { it.text == "Resolve\u2026" } })
    }

    fun `test banner hides once orphans clear after a reload`() {
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val controller = controller()
        edt { controller.reload() }
        flush()
        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()
        assertTrue(edt { banner.isVisible })

        rpc.orphans = emptyList()
        edt { controller.reload() }
        flush()
        edt { banner.refresh() }

        assertFalse(edt { banner.isVisible })
    }

    /**
     * `orphanSizes` answers empty when the walk fails outright, which must not be read as "these
     * folders are 0 bytes" — the banner drops the size claim instead of stating a wrong one, and does
     * not keep re-running the failing walk on every refresh.
     */
    fun `test banner drops the size claim when the size pass fails instead of reporting zero bytes`() {
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        rpc.orphanSizesResult = { emptyMap() }
        val controller = controller()
        edt { controller.reload() }
        flush()

        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()

        assertEquals("1 leftover worktree folder(s)", edt { banner.text })
        assertEquals(1, rpc.orphanSizeCalls.size)

        edt { banner.refresh() }
        flush()

        assertEquals("1 leftover worktree folder(s)", edt { banner.text })
        assertEquals("a failed walk must not be retried on every refresh", 1, rpc.orphanSizeCalls.size)
    }

    /**
     * A walk that omits some paths (permission error on one folder) is not a total either: summing it
     * would silently undercount, so the banner reports the count alone.
     */
    fun `test banner drops the size claim when the size pass covers only some folders`() {
        rpc.orphans = listOf(
            OrphanDto("/repo/.kilo/worktrees/first", OrphanKind.LEFTOVER),
            OrphanDto("/repo/.kilo/worktrees/second", OrphanKind.LEFTOVER),
        )
        rpc.orphanSizesResult = { mapOf("/repo/.kilo/worktrees/first" to 4096L) }
        val controller = controller()
        edt { controller.reload() }
        flush()

        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()

        assertEquals("2 leftover worktree folder(s)", edt { banner.text })
    }

    /**
     * The fs walk is the expensive half of a size pass, so a pass whose answer is already worthless
     * has to be cancelled rather than left running to be discarded when it lands.
     */
    fun `test a size pass is cancelled when the orphan set changes under it`() {
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/first", OrphanKind.LEFTOVER))
        val gate = CompletableDeferred<Unit>()
        val walked = AtomicInteger()
        rpc.beforeOrphanSizes = { gate.await() }
        rpc.orphanSizesResult = { paths ->
            walked.incrementAndGet()
            paths.associateWith { 512L }
        }
        val controller = controller()
        edt { controller.reload() }
        flush()
        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()
        assertEquals(1, rpc.orphanSizeCalls.size)

        // The orphan set changes while the first walk is still parked on the gate.
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/second", OrphanKind.LEFTOVER))
        edt { controller.reload() }
        flush()
        edt { banner.refresh() }
        flush()
        assertEquals(2, rpc.orphanSizeCalls.size)

        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { walked.get() > 0 })
        flush()

        // Only the current pass ever produced an answer; the superseded one was cancelled at the gate
        // instead of walking to completion.
        assertEquals("the superseded walk must not run", 1, walked.get())
        assertEquals("1 leftover worktree folder(s) \u00b7 512 B", edt { banner.text })
    }

    /**
     * Clicking delete makes the pass in flight pointless — it is holding the very paths about to be
     * renamed away — so it is cancelled, and the reload afterwards measures only what is left.
     */
    fun `test removing folders cancels the size pass and re-measures the leftovers`() {
        val doomed = "/repo/.kilo/worktrees/doomed"
        val survivor = "/repo/.kilo/worktrees/survivor"
        rpc.orphans = listOf(OrphanDto(doomed, OrphanKind.LEFTOVER), OrphanDto(survivor, OrphanKind.LEFTOVER))
        val gate = CompletableDeferred<Unit>()
        val walked = AtomicInteger()
        rpc.beforeOrphanSizes = { gate.await() }
        rpc.orphanSizesResult = { paths ->
            walked.incrementAndGet()
            paths.associateWith { 1024L }
        }
        val controller = controller()
        edt { controller.reload() }
        flush()
        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        // Mirrors AgentManagerPanel, which is what refreshes the banner after every reload.
        controller.onReload = { banner.refresh() }
        flush()
        assertEquals(1, rpc.orphanSizeCalls.size)
        assertEquals("2 leftover worktree folder(s) \u00b7 calculating size\u2026", edt { banner.text })

        // Delete one folder; the walk over both is still parked on the gate. Later passes are ungated
        // so the re-measure can actually land.
        rpc.beforeOrphanSizes = {}
        rpc.orphans = listOf(OrphanDto(survivor, OrphanKind.LEFTOVER))
        edt { banner.remove(listOf(doomed)) }
        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { rpc.orphanSizeCalls.size > 1 })
        flush()

        assertEquals(listOf(doomed), rpc.removeOrphansCalls.single().second)
        // The cancelled pass never walked; the pass after the delete covers the survivor alone.
        assertEquals("only the post-delete pass runs", 1, walked.get())
        assertEquals(listOf(survivor), rpc.orphanSizeCalls.last().second)
        assertEquals("1 leftover worktree folder(s) \u00b7 1.02 kB", edt { banner.text })
    }

    fun `test banner does not re-fetch sizes when the orphan set is unchanged`() {
        rpc.orphans = listOf(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        rpc.orphanSizesResult = { mapOf("/repo/.kilo/worktrees/leftover" to 10L) }
        val controller = controller()
        edt { controller.reload() }
        flush()
        val banner = edt { OrphanBanner(project, controller, testRootDisposable) }
        flush()
        assertEquals(1, rpc.orphanSizeCalls.size)

        // A reload that reports the exact same orphan path set must not trigger another size fetch.
        edt { controller.reload() }
        flush()
        edt { banner.refresh() }
        flush()

        assertEquals(1, rpc.orphanSizeCalls.size)
    }

    private fun controller(
        activity: MutableStateFlow<Map<String, ai.kilocode.rpc.dto.SessionActivityDto>> = MutableStateFlow(emptyMap()),
    ) = WorktreeController(service, "/repo", coroutines.scope, activity = activity)

    private fun links(root: java.awt.Component): List<HyperlinkLabel> = components(root).filterIsInstance<HyperlinkLabel>()

    private fun components(root: java.awt.Component): List<java.awt.Component> = buildList {
        add(root)
        if (root is java.awt.Container) root.components.forEach { addAll(components(it)) }
    }

    private fun flush() = coroutines.drain(::pump)

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun pump() = pumpEdt()
}
