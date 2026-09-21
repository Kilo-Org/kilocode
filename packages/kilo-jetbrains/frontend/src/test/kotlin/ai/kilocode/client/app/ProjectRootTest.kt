package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.launch
import java.util.concurrent.CopyOnWriteArrayList

class ProjectRootTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorkspaceRpcApi

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = fakeRoot(project, coroutines.scope, testRootDisposable, ROOT)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pumpEdt)
        } finally {
            super.tearDown()
        }
    }

    fun `test root resolves through the backend instead of the frontend base path`() {
        val seen = resolve(1)

        assertEquals(listOf(ROOT), seen)
        assertEquals(1, rpc.resolveCalls)
        assertFalse(ROOT == project.basePath)
    }

    fun `test root is resolved once and cached for later callers`() {
        val seen = resolve(5)

        assertEquals(List(5) { ROOT }, seen)
        assertEquals(1, rpc.resolveCalls)
    }

    private fun resolve(count: Int): List<String> {
        val seen = CopyOnWriteArrayList<String>()
        repeat(count) {
            coroutines.scope.launch { seen.add(project.service<ProjectRoot>().get()) }
        }
        assertTrue(coroutines.pumpUntil { seen.size == count })
        return seen.toList()
    }

    private companion object {
        private const val ROOT = "/real/repo"
    }
}
