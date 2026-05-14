package ai.kilocode.client.fs

import com.intellij.openapi.vfs.DeprecatedVirtualFileSystem
import com.intellij.openapi.vfs.NonPhysicalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

class KiloVirtualFileSystem : DeprecatedVirtualFileSystem(), NonPhysicalFileSystem {
    companion object {
        const val PROTOCOL = "kilo"

        private val local = KiloVirtualFileSystem()

        fun getInstance(): KiloVirtualFileSystem {
            val fs = VirtualFileManager.getInstance().getFileSystem(PROTOCOL)
            if (fs is KiloVirtualFileSystem) return fs
            return local
        }
    }

    private val files = ConcurrentHashMap<String, KiloVirtualFile>()

    override fun getProtocol(): String = PROTOCOL

    fun file(target: KiloEditorTarget): KiloVirtualFile {
        return files.computeIfAbsent(target.path) { KiloVirtualFile(this, target) }
    }

    override fun findFileByPath(path: String): VirtualFile? {
        val target = KiloEditorTarget.parse(path) ?: return null
        return file(target)
    }

    override fun refreshAndFindFileByPath(path: String): VirtualFile? = findFileByPath(path)

    override fun refresh(asynchronous: Boolean) = Unit

    @Throws(IOException::class)
    override fun deleteFile(requestor: Any?, vFile: VirtualFile) {
        throw IOException("Kilo virtual files are read-only")
    }

    @Throws(IOException::class)
    override fun moveFile(requestor: Any?, vFile: VirtualFile, newParent: VirtualFile) {
        throw IOException("Kilo virtual files are read-only")
    }

    @Throws(IOException::class)
    override fun renameFile(requestor: Any?, vFile: VirtualFile, newName: String) {
        throw IOException("Kilo virtual files are read-only")
    }

    @Throws(IOException::class)
    override fun createChildFile(requestor: Any?, vDir: VirtualFile, fileName: String): VirtualFile {
        throw IOException("Kilo virtual files are read-only")
    }

    @Throws(IOException::class)
    override fun createChildDirectory(requestor: Any?, vDir: VirtualFile, dirName: String): VirtualFile {
        throw IOException("Kilo virtual files are read-only")
    }

    @Throws(IOException::class)
    override fun copyFile(requestor: Any?, vFile: VirtualFile, newParent: VirtualFile, copyName: String): VirtualFile {
        throw IOException("Kilo virtual files are read-only")
    }
}
