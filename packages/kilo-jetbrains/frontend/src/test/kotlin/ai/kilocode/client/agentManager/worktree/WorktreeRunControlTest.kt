package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.testing.FakeRunRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.application.ApplicationManager
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

    fun `test run states subscribe with the resolved backend root`() {
        control()

        assertTrue(coroutines.pumpUntil { run.stateDirs.isNotEmpty() })
        assertEquals(listOf(ROOT), run.stateDirs.toList())
        assertFalse(run.stateDirs.contains(project.basePath))
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

    private fun control() = edtWait { WorktreeRunControl(project, testRootDisposable, WORKTREE) {} }

    private companion object {
        private const val ROOT = "/real/repo"
        private const val WORKTREE = "$ROOT/.kilo/worktrees/feature-x"
    }
}
