package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.WorktreeSessionFileType
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.ensureWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.unregisterWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVirtualFileKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.components.service
import com.intellij.openapi.vfs.VirtualFilePathWrapper
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class WorktreeSessionEditorKindTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            service<WorktreeNameCache>().clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test worktree session params use only the worktree path`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val params = worktreeSessionParams(item)

        assertEquals(mapOf("path" to item.path), params)
    }

    fun `test worktree session kind creates a custom virtual file type`() {
        ensureWorktreeSessionEditorKind()
        val fs = KiloVirtualFileSystem.getInstance()
        val path = KiloPath(WorktreeSessionEditorKind.ID, mapOf("path" to "/repo/.kilo/worktrees/feature-x"))
        val file = fs.findOrCreateFile(path)

        assertNotNull(file)
        assertSame(WorktreeSessionFileType, file!!.fileType)
        assertEquals("feature-x", file.name)
        assertEquals("/repo/.kilo/worktrees/feature-x", (file as VirtualFilePathWrapper).presentablePath)
        assertNotNull(service<KiloEditorKindRegistry>().get(WorktreeSessionEditorKind.ID))
        assertNotNull(service<KiloVirtualFileKindRegistry>().get(WorktreeSessionEditorKind.ID))

        unregisterWorktreeSessionEditorKind()
        fs.clear()

        assertNull(service<KiloEditorKindRegistry>().get(WorktreeSessionEditorKind.ID))
        assertNull(service<KiloVirtualFileKindRegistry>().get(WorktreeSessionEditorKind.ID))
        assertNull(fs.findOrCreateFile(path))
    }

    fun `test worktree session title uses cached label`() {
        val path = "/repo/.kilo/worktrees/feature-x"
        service<WorktreeNameCache>().put(path, "Feature Label")

        assertEquals("Feature Label", WorktreeSessionEditorKind.title(mapOf("path" to path)))
    }

    fun `test worktree session title uses same winning label as worktree list`() {
        val path = "/repo/.kilo/worktrees/feature-x"
        service<WorktreeNameCache>().put(path, "Feature Label")
        service<WorktreeNameCache>().putPr(path, WorktreePrDto(path, 3, GhState.OPEN, "https://example.test/pr/3", "PR Label"))

        assertEquals("PR Label", WorktreeSessionEditorKind.title(mapOf("path" to path)))
    }
}
