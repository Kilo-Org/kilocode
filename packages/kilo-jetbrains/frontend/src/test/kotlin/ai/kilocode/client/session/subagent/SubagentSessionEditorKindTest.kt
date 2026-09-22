package ai.kilocode.client.session.subagent

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.AgentAvatar
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVirtualFileKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import com.intellij.icons.AllIcons
import com.intellij.openapi.components.service
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.vfs.VirtualFilePathWrapper
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.image.BufferedImage
import javax.swing.Icon

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
        val icon = SubagentSessionEditorKind.icon(path.params)
        assertNotSame(AllIcons.Nodes.Function, icon)
        assertEquals(JBUI.scale(16), icon.iconWidth)
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

    fun `test icon falls back to the identity's own hashed hue without a cached color`() {
        val params = subagentSessionParams("ses_child", "/repo")

        val icon = SubagentSessionEditorKind.icon(params)

        assertPixelsEqual(AgentAvatar.static("ses_child"), icon)
    }

    fun `test icon picks up the palette color cached at open time`() {
        service<SubagentTitleCache>().put("ses_child", "Explore Agent", color = 3)
        val params = subagentSessionParams("ses_child", "/repo")

        val icon = SubagentSessionEditorKind.icon(params)

        assertPixelsEqual(AgentAvatar.static("ses_child", color = 3), icon)
        // Distinguishes an actual color pickup from a coincidental match with the hashed default.
        assertPixelsNotEqual(AgentAvatar.static("ses_child"), icon)
    }

    fun `test color lookup is safe to call off the EDT`() {
        service<SubagentTitleCache>().put("ses_child", "Explore Agent", color = 5)

        // KiloFileIconProvider is queried by the platform from a background read action; this must
        // not throw an EDT-thread assertion or corrupt the underlying LRU map.
        var result: Int? = null
        var failure: Throwable? = null
        val thread = Thread {
            try {
                result = service<SubagentTitleCache>().color("ses_child")
            } catch (t: Throwable) {
                failure = t
            }
        }
        thread.start()
        thread.join()

        assertNull(failure)
        assertEquals(5, result)
    }

    private fun assertPixelsEqual(expected: Icon, actual: Icon) {
        assertTrue(pixels(expected).contentEquals(pixels(actual)))
    }

    private fun assertPixelsNotEqual(expected: Icon, actual: Icon) {
        assertFalse(pixels(expected).contentEquals(pixels(actual)))
    }

    private fun pixels(icon: Icon): IntArray {
        val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            icon.paintIcon(null, g, 0, 0)
        } finally {
            g.dispose()
        }
        return image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
    }
}
