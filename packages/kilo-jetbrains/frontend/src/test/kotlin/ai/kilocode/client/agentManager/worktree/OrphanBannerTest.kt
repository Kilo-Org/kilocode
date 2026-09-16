package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.OrphanDto
import ai.kilocode.rpc.dto.OrphanKind
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.HyperlinkLabel
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
        assertEquals("1 leftover worktree folder(s)", edt { banner.text })

        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { edt { banner.text } != "1 leftover worktree folder(s)" })

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
