package ai.kilocode.client.fs

import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class KiloEditorProviderTest : BasePlatformTestCase() {

    fun `test accepts profile virtual file`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile")!!
        assertTrue(KiloEditorProvider().accept(project, file))
    }

    fun `test filesystem instance falls back when extension lookup is unavailable`() {
        val fs = KiloVirtualFileSystem.getInstance()
        val file = fs.findFileByPath("profile")
        assertNotNull(file)
        assertEquals("profile", file!!.path)
    }

    fun `test rejects unknown path`() {
        val fs = KiloVirtualFileSystem()
        val unknown = fs.findFileByPath("settings")
        assertNull(unknown)
    }

    fun `test uses hidden default editor policy`() {
        assertEquals(FileEditorPolicy.HIDE_DEFAULT_EDITOR, KiloEditorProvider().policy)
    }

    fun `test editor type id is kilo-editor`() {
        assertEquals("kilo-editor", KiloEditorProvider().editorTypeId)
    }

    fun `test creates empty profile editor`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile")!!
        val editor = KiloEditorProvider().createEditor(project, file)
        try {
            assertEquals("Kilo Profile", editor.name)
            assertFalse(editor.isModified)
            assertTrue(editor.isValid)
            assertNotNull(editor.component)
            assertSame(file, editor.file)
        } finally {
            editor.dispose()
        }
    }

    fun `test accept requires no read action`() {
        assertFalse(KiloEditorProvider().acceptRequiresReadAction())
    }
}
