package ai.kilocode.client.vfs

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.JComponent

@Suppress("UnstableApiUsage")
class KiloVfsManagerTest : BasePlatformTestCase() {
    private val kind = "test-close"

    override fun setUp() {
        super.setUp()
        service<KiloEditorKindRegistry>().register(TestKind)
    }

    override fun tearDown() {
        try {
            service<KiloEditorKindRegistry>().unregister(kind)
            KiloVirtualFileSystem.getInstance().clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test close closes the open editor and releases the cache`() {
        val params = mapOf("path" to "/repo/wt")
        val vfs = project.service<KiloVfsManager>()
        val manager = FileEditorManager.getInstance(project)

        edtWait { assertTrue(vfs.open(kind, params)) }
        assertTrue(manager.openFiles.any { it is KiloVirtualFile })

        edtWait { vfs.close(kind, params) }

        assertTrue(manager.openFiles.none { it is KiloVirtualFile })
        assertNull(KiloVirtualFileSystem.getInstance().cached(KiloPath(kind, params)))
    }

    fun `test close matches by canonical params after the cache was released`() {
        // Two params so canonicalization sorts them; open and close use different insertion orders.
        val opened = linkedMapOf("path" to "/repo/wt", "extra" to "1")
        val closed = linkedMapOf("extra" to "1", "path" to "/repo/wt")
        val vfs = project.service<KiloVfsManager>()
        val manager = FileEditorManager.getInstance(project)

        edtWait { assertTrue(vfs.open(kind, opened)) }
        assertTrue(manager.openFiles.any { it is KiloVirtualFile })

        // Drop the VFS cache entry so close() must fall back to scanning the open editors.
        KiloVirtualFileSystem.getInstance().release(KiloPath(kind, opened))
        assertNull(KiloVirtualFileSystem.getInstance().cached(KiloPath(kind, opened)))

        edtWait { vfs.close(kind, closed) }

        assertTrue(manager.openFiles.none { it is KiloVirtualFile })
    }

    private object TestKind : KiloEditorKind {
        override val id: String = "test-close"

        override fun title(params: Map<String, String>): String = "Test"

        override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent =
            BorderLayoutPanel()
    }
}
