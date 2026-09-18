package ai.kilocode.client.session.subagent

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVirtualFileKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import com.intellij.openapi.components.service
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.vfs.VirtualFilePathWrapper
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class SubagentSessionEditorKindTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            service<SubagentTitleCache>().clear()
        } finally {
            super.tearDown()
        }
    }

    fun testSubagentSessionParamsUseStableIdentityFields() {
        val params = subagentSessionParams("ses_child", "/repo")
        val path = KiloPath(SubagentSessionEditorKind.ID, params).canonical()
        val json = KiloVirtualFileSystem.getInstance().getPath(path)
        val decoded = KiloVirtualFileSystem.decode(json)

        assertEquals(path, decoded)
        assertEquals(SubagentSessionEditorKind.ID, path.kind)
        assertEquals("ses_child", params["sessionId"])
        assertEquals("/repo", params["directory"])
        assertFalse(json.contains("title", ignoreCase = true))
    }

    fun testSubagentSessionKindCreatesVirtualFile() {
        ensureSubagentSessionEditorKind()
        val fs = KiloVirtualFileSystem.getInstance()
        val path = KiloPath(SubagentSessionEditorKind.ID, subagentSessionParams("ses_child", "/repo"))
        val file = fs.findOrCreateFile(path)

        assertNotNull(file)
        assertSame(FileTypes.UNKNOWN, file!!.fileType)
        assertNotNull(SubagentSessionEditorKind.icon(path.params))
        assertEquals(KiloBundle.message("session.subagent.title"), file.name)
        assertEquals(KiloBundle.message("session.subagent.path", "ses_child"), (file as VirtualFilePathWrapper).presentablePath)
        assertNotNull(service<KiloEditorKindRegistry>().get(SubagentSessionEditorKind.ID))
        assertNotNull(service<KiloVirtualFileKindRegistry>().get(SubagentSessionEditorKind.ID))

        unregisterSubagentSessionEditorKind()
        fs.clear()

        assertNull(service<KiloEditorKindRegistry>().get(SubagentSessionEditorKind.ID))
        assertNull(service<KiloVirtualFileKindRegistry>().get(SubagentSessionEditorKind.ID))
        assertNull(fs.findOrCreateFile(path))
    }

    fun testSubagentSessionTitleUsesCache() {
        service<SubagentTitleCache>().put("ses_child", "Explore Agent - Find files")

        assertEquals("Explore Agent - Find files", SubagentSessionEditorKind.title(subagentSessionParams("ses_child", "/repo")))
    }

    fun testSubagentSessionTitleFallsBack() {
        assertEquals(KiloBundle.message("session.subagent.title"), SubagentSessionEditorKind.title(subagentSessionParams("ses_child", "/repo")))
    }

    fun testSubagentTitleCacheEvictsLeastRecentlyUsed() {
        val cache = service<SubagentTitleCache>()
        repeat(200) { cache.put("ses_$it", "Title $it") }

        // Oldest untouched entries are evicted; recent ones survive.
        assertNull(cache.title("ses_0"))
        assertEquals("Title 199", cache.title("ses_199"))
    }

    fun testSubagentSessionKindRequiresSessionAndDirectory() {
        assertFalse(SubagentSessionEditorKind.isValid(subagentSessionParams("", "/repo")))
        assertFalse(SubagentSessionEditorKind.isValid(subagentSessionParams("ses_child", "")))
        assertTrue(SubagentSessionEditorKind.isValid(subagentSessionParams("ses_child", "/repo")))
    }
}
