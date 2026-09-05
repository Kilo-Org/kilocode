package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService

@Suppress("UnstableApiUsage")
class WorktreeSessionListVisibilityTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var visibility: WorktreeSessionListVisibility

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        visibility = WorktreeSessionListVisibility(coroutines.scope)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test load answers with the stored value on the edt`() {
        rpc.sessionLists[DIR] = true
        val values = mutableListOf<Boolean?>()
        val threads = mutableListOf<Boolean>()

        visibility.load(DIR) { value ->
            values += value
            threads += ApplicationManager.getApplication().isDispatchThread
        }
        drain()

        assertEquals(listOf(DIR), rpc.sessionListReads.toList())
        assertEquals(listOf<Boolean?>(true), values)
        assertEquals(listOf(true), threads)
    }

    fun `test load answers with nothing for a worktree without a stored choice`() {
        val values = mutableListOf<Boolean?>()

        visibility.load(DIR) { values += it }
        drain()

        assertEquals(listOf<Boolean?>(null), values)
    }

    fun `test load degrades to nothing when the backend fails`() {
        rpc.sessionLists[DIR] = true
        rpc.sessionListThrows = RuntimeException("backend down")
        val values = mutableListOf<Boolean?>()

        visibility.load(DIR) { values += it }
        drain()

        assertEquals(listOf<Boolean?>(null), values)
    }

    fun `test save records the visibility a later load reads back`() {
        visibility.save(DIR, false)
        drain()

        assertEquals(listOf(DIR to false), rpc.sessionListWrites.toList())

        val values = mutableListOf<Boolean?>()
        visibility.load(DIR) { values += it }
        drain()

        assertEquals(listOf<Boolean?>(false), values)
    }

    fun `test save survives a failing backend`() {
        rpc.sessionListThrows = RuntimeException("backend down")

        visibility.save(DIR, true)
        drain()

        assertEquals(listOf(DIR to true), rpc.sessionListWrites.toList())
    }

    private fun drain() = coroutines.drain(::pump)

    private fun pump() = pumpEdt()

    private companion object {
        const val DIR = "/repo/.kilo/worktrees/feature-x"
    }
}
