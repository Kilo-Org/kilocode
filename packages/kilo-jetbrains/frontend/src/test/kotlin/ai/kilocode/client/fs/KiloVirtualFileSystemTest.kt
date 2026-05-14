package ai.kilocode.client.fs

import com.intellij.icons.AllIcons
import junit.framework.TestCase

class KiloVirtualFileSystemTest : TestCase() {

    fun `test find profile file`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile")
        assertNotNull(file)
        assertEquals("kilo", file!!.fileSystem.protocol)
        assertEquals("profile", file.path)
        assertEquals("Kilo Profile", file.name)
    }

    fun `test profile file url`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile") as KiloVirtualFile
        assertEquals("kilo://profile", file.target.url)
    }

    fun `test profile file is cached`() {
        val fs = KiloVirtualFileSystem()
        assertSame(fs.findFileByPath("profile"), fs.findFileByPath("profile"))
    }

    fun `test profile file is empty read only non directory`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile")!!
        assertFalse(file.isDirectory)
        assertFalse(file.isWritable)
        assertTrue(file.isValid)
        assertEquals(0, file.modificationStamp)
        assertEquals(0, file.contentsToByteArray().size)
    }

    fun `test profile file has user file type icon`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.findFileByPath("profile")!!
        assertSame(KiloFileType, file.fileType)
        assertSame(AllIcons.General.User, file.fileType.icon)
    }

    fun `test unknown paths are not supported`() {
        val fs = KiloVirtualFileSystem()
        assertNull(fs.findFileByPath("account"))
        assertNull(fs.findFileByPath("settings"))
        assertNull(fs.findFileByPath("missing"))
    }

    fun `test refresh and find delegates to find`() {
        val fs = KiloVirtualFileSystem()
        val file = fs.refreshAndFindFileByPath("profile")
        assertNotNull(file)
        assertEquals("profile", file!!.path)
    }
}
