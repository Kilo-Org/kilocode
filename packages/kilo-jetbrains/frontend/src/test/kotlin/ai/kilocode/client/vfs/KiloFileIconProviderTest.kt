package ai.kilocode.client.vfs

import ai.kilocode.client.session.subagent.SubagentSessionEditorKind
import ai.kilocode.client.session.subagent.ensureSubagentSessionEditorKind
import ai.kilocode.client.session.subagent.subagentSessionParams
import ai.kilocode.client.session.subagent.unregisterSubagentSessionEditorKind
import com.intellij.icons.AllIcons
import com.intellij.testFramework.LightVirtualFile
import com.intellij.util.IconUtil
import com.intellij.util.ui.JBUI

class KiloFileIconProviderTest : com.intellij.testFramework.fixtures.BasePlatformTestCase() {
    override fun tearDown() {
        try {
            unregisterSubagentSessionEditorKind()
        } finally {
            super.tearDown()
        }
    }

    fun `test a non-Kilo file is left to the ordinary file-type icon`() {
        val provider = KiloFileIconProvider()

        assertNull(provider.getIcon(LightVirtualFile("plain.txt"), 0, project))
    }

    fun `test a subagent tab resolves its generated avatar through the provider directly`() {
        ensureSubagentSessionEditorKind()
        val path = KiloPath(SubagentSessionEditorKind.ID, subagentSessionParams("ses_child", "/repo"))
        val file = KiloVirtualFileSystem.getInstance().findOrCreateFile(path)!!

        val icon = KiloFileIconProvider().getIcon(file, 0, project)

        assertNotNull(icon)
        assertEquals(JBUI.scale(16), icon!!.iconWidth)
        assertEquals(JBUI.scale(16), icon.iconHeight)
    }

    fun `test the same subagent tab resolves through the real platform icon pipeline`() {
        ensureSubagentSessionEditorKind()
        val path = KiloPath(SubagentSessionEditorKind.ID, subagentSessionParams("ses_child", "/repo"))
        val file = KiloVirtualFileSystem.getInstance().findOrCreateFile(path)!!

        // Exercises the full public resolution chain (`FileIconProvider`s, then the file-type
        // fallback, then patchers/overlays) rather than just this provider in isolation, so a
        // registration or ordering mistake in the plugin descriptor would fail this test even if
        // `KiloFileIconProvider` itself is correct.
        val icon = IconUtil.computeFileIcon(file, 0, project)

        assertNotSame(AllIcons.FileTypes.Unknown, icon)
    }

    fun `test a subagent tab without a session id falls back to the generic icon`() {
        ensureSubagentSessionEditorKind()
        val path = KiloPath(SubagentSessionEditorKind.ID, subagentSessionParams("", "/repo"))
        val file = KiloVirtualFileSystem.getInstance().findOrCreateFile(path)!!

        assertSame(AllIcons.Nodes.Function, KiloFileIconProvider().getIcon(file, 0, project))
    }

    fun `test a project-null lookup still resolves the static identity`() {
        ensureSubagentSessionEditorKind()
        val path = KiloPath(SubagentSessionEditorKind.ID, subagentSessionParams("ses_child", "/repo"))
        val file = KiloVirtualFileSystem.getInstance().findOrCreateFile(path)!!

        assertNotNull(KiloFileIconProvider().getIcon(file, 0, null))
    }
}
