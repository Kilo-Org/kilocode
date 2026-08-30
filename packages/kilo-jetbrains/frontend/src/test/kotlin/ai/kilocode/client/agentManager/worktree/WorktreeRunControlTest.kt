package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeRunRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService

@Suppress("UnstableApiUsage")
class WorktreeRunControlTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var run: FakeRunRpcApi

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        run = FakeRunRpcApi()
        fakeRoot(project, coroutines.scope, testRootDisposable, ROOT)
        ApplicationManager.getApplication()
            .replaceService(KiloRunService::class.java, KiloRunService(coroutines.scope, run), testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pumpEdt)
        } finally {
            super.tearDown()
        }
    }

    fun `test button is labeled Build Run with a dropdown arrow`() {
        val control = control()

        assertEquals("${KiloBundle.message("worktree.run.action")} ▾", edtWait { control.button.text })
    }

    fun `test run states subscribe with the resolved backend root`() {
        control()

        assertTrue(coroutines.pumpUntil { run.stateDirs.isNotEmpty() })
        assertEquals(listOf(ROOT), run.stateDirs.toList())
        assertFalse(run.stateDirs.contains(project.basePath))
    }

    fun `test multiple controls share a single backend states stream`() {
        control()
        control()

        assertTrue(coroutines.pumpUntil { run.stateDirs.isNotEmpty() })
        coroutines.drain(::pumpEdt)
        // Both editors attach to the shared project WorktreeRunStatusService, so the backend
        // states stream is opened exactly once instead of once per open worktree editor.
        assertEquals(listOf(ROOT), run.stateDirs.toList())
    }

    fun `test a process in this worktree switches the button to the live indicator`() {
        val control = control()
        assertTrue(coroutines.pumpUntil { run.stateDirs.isNotEmpty() })
        val idle = edtWait { control.button.icon }

        run.states.value = listOf(RunStateDto("id1", "dev [wt]", WORKTREE))

        assertTrue(coroutines.pumpUntil { edtWait { control.button.icon } !== idle })
    }

    fun `test a process in another worktree leaves the button idle`() {
        val control = control()
        assertTrue(coroutines.pumpUntil { run.stateDirs.isNotEmpty() })
        val idle = edtWait { control.button.icon }

        run.states.value = listOf(RunStateDto("id1", "dev [other]", "$ROOT/.kilo/worktrees/other"))

        coroutines.drain(::pumpEdt)
        assertSame(idle, edtWait { control.button.icon })
    }

    fun `test build and rebuild reach the backend with the clean flag`() {
        service<KiloRunService>().buildInBackground(ROOT, WORKTREE, clean = false)
        assertTrue(coroutines.pumpUntil { run.builds.size == 1 })
        service<KiloRunService>().buildInBackground(ROOT, WORKTREE, clean = true)
        assertTrue(coroutines.pumpUntil { run.builds.size == 2 })

        assertEquals(
            listOf(Triple(ROOT, WORKTREE, false), Triple(ROOT, WORKTREE, true)),
            run.builds.toList(),
        )
    }

    private fun control() = edtWait { WorktreeRunControl(project, testRootDisposable, WORKTREE) {} }

    private companion object {
        private const val ROOT = "/real/repo"
        private const val WORKTREE = "$ROOT/.kilo/worktrees/feature-x"
    }
}
