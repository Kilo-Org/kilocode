package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class WorktreeNameCacheTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            edt { cache().clear() }
        } finally {
            super.tearDown()
        }
    }

    fun `test put and remove notify only when value changes`() = edt {
        val events = mutableListOf<Pair<String, String?>>()
        cache().addListener(testRootDisposable) { path, name -> events += path to name }

        cache().put("/repo/wt", "First")
        cache().put("/repo/wt", "First")
        cache().put("/repo/wt", "Second")
        cache().remove("/repo/wt")
        cache().remove("/repo/wt")

        assertEquals(
            listOf("/repo/wt" to "First", "/repo/wt" to "Second", "/repo/wt" to null),
            events,
        )
    }

    fun `test bulk sync updates names without notifying`() = edt {
        val events = mutableListOf<Pair<String, String?>>()
        cache().addListener(testRootDisposable) { path, name -> events += path to name }

        cache().putAll(listOf(WorktreeDto("/repo/wt", "Feature", "feature/x", "/repo/wt")))

        assertEquals("Feature", cache().get("/repo/wt"))
        assertTrue(events.isEmpty())
    }

    fun `test title prefers PR title then worktree name`() = edt {
        val path = "/repo/wt"
        cache().put(path, "Feature")

        assertEquals("Feature", cache().title(path))

        cache().putPr(path, WorktreePrDto(path, 12, GhState.OPEN, "https://example.test/pr/12", "PR Title"))
        assertEquals("PR Title", cache().title(path))

        cache().putPr(path, WorktreePrDto(path, 12, GhState.OPEN, "https://example.test/pr/12", "   "))
        assertEquals("Feature", cache().title(path))
    }

    fun `test listener is removed with parent disposable`() = edt {
        val parent = Disposer.newDisposable("worktree-cache-listener")
        Disposer.register(testRootDisposable, parent)
        val events = mutableListOf<Pair<String, String?>>()
        cache().addListener(parent) { path, name -> events += path to name }

        cache().put("/repo/one", "One")
        Disposer.dispose(parent)
        cache().put("/repo/two", "Two")

        assertEquals(listOf("/repo/one" to "One"), events)
    }

    private fun cache(): WorktreeNameCache = ApplicationManager.getApplication().service()

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
