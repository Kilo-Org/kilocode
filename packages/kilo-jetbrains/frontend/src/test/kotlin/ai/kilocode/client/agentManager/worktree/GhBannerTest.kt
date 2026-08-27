package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.HyperlinkLabel
import java.awt.Component
import java.awt.Container

@Suppress("UnstableApiUsage")
class GhBannerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var timers: TestUiTimers
    private lateinit var service: GhStatusCoordinator

    override fun setUp() {
        super.setUp()
        installBrowser()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        timers = TestUiTimers()
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        service = GhStatusCoordinator(coroutines.scope, timers)
        ApplicationManager.getApplication().replaceService(GhStatusCoordinator::class.java, service, testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test banner initializes from coordinator state`() {
        edt { service.report(project, GhAvailability.MISSING) }
        pump()

        val banner = edt { GhBanner(project, testRootDisposable) }

        assertTrue(edt { banner.isVisible })
        assertEquals("Install gh to show pull request badges for worktrees.", edt { banner.text })
        assertNotNull(edt { links(banner).singleOrNull { it.text == "Learn more" } })
    }

    fun `test banner shows git install guidance`() {
        edt { service.report(project, GhAvailability.GIT_MISSING) }
        pump()

        val banner = edt { GhBanner(project, testRootDisposable) }

        assertTrue(edt { banner.isVisible })
        assertEquals("Install Git to show worktree stats and pull request badges.", edt { banner.text })
        assertNotNull(edt { links(banner).singleOrNull { it.text == "Learn more" } })
    }

    fun `test banner hides immediately when coordinator reports ok`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val banner = edt { GhBanner(project, testRootDisposable) }

        edt { service.report(project, GhAvailability.UNAUTH) }
        pump()
        assertTrue(edt { banner.isVisible })
        assertNotNull(edt { links(banner).singleOrNull { it.text == "Authorize" } })
        assertNotNull(edt { links(banner).singleOrNull { it.text == "Learn more" && it.isVisible } })

        edt { service.report(project, GhAvailability.OK) }
        pump()

        assertFalse(edt { banner.isVisible })
    }

    private fun links(root: Component): List<HyperlinkLabel> = components(root).filterIsInstance<HyperlinkLabel>()

    private fun components(root: Component): List<Component> = buildList {
        add(root)
        if (root is Container) root.components.forEach { addAll(components(it)) }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun pump() = pumpEdt()
}
